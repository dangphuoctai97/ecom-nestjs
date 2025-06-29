import { HttpException, Injectable, UnauthorizedException, UnprocessableEntityException } from '@nestjs/common'
import { addMilliseconds } from 'date-fns'
import { LoginBodyType, RefreshTokenBodyType, RegisterBodyType, SendOTPBodyType } from 'src/routes/auth/auth.model'
import { AuthRepository } from 'src/routes/auth/auth.repo'
import { RolesService } from 'src/routes/auth/roles.service'
import envConfig from 'src/shared/config'
import { generateOTP, isNotFoundPrismaError, isUniqueConstraintPrismaError } from 'src/shared/helpers'
import { SharedUserRepository } from 'src/shared/repositories/shared-user.repo'
import { HashingService } from 'src/shared/services/hashing.service'
import { TokenService } from 'src/shared/services/token.service'
import { TypeOfVerificationCode } from 'src/shared/constants/auth.constant'
import { EmailService } from 'src/shared/services/email.service'
import { AccessTokenPayloadCreate } from 'src/shared/types/jwt.type'
import ms from 'ms'
import { MessageResType } from 'src/shared/models/response.model'

@Injectable()
export class AuthService {
  constructor(
    private readonly hashingService: HashingService,
    private readonly tokenService: TokenService,
    private readonly rolesService: RolesService,
    private readonly authRepository: AuthRepository,
    private readonly sharedUserRepository: SharedUserRepository,
    private readonly emailService: EmailService,
  ) {}
  async register(body: RegisterBodyType) {
    try {
      //Tìm trong DB xem có OTP hay không
      const verificationCode = await this.authRepository.findUniqueVerificationCode({
        email: body.email,
        code: body.code,
        type: TypeOfVerificationCode.REGISTER,
      })

      //Không có thì show lỗi
      if (!verificationCode) {
        throw new UnprocessableEntityException([
          {
            message: 'Mã OTP không hợp lệ',
            path: 'code',
          },
        ])
      }

      //Có mà hết hạn
      if (verificationCode.expiresAt < new Date()) {
        throw new UnprocessableEntityException([
          {
            message: 'Mã OTP đã hết hạn',
            path: 'code',
          },
        ])
      }

      const clientRoleId = await this.rolesService.getClientRoleId()
      const hashedPassword = await this.hashingService.hash(body.password)
      return await this.authRepository.createUser({
        email: body.email,
        name: body.name,
        roleId: clientRoleId,
        password: hashedPassword,
        phoneNumber: body.phoneNumber,
      })
    } catch (error) {
      if (isUniqueConstraintPrismaError(error)) {
        throw new UnprocessableEntityException({
          path: 'email',
          message: 'Email đã tồn tại',
        })
      }
      throw error
    }
  }

  async sendOTP(body: SendOTPBodyType): Promise<MessageResType> {
    //1.Kiểm tra email đã tồn tại trong DB hay chưa
    //Nếu đã tồn tại, thông báo cho người dùng email đã tồn tại

    const user = await this.sharedUserRepository.findUnique({ email: body.email })
    if (user) {
      throw new UnprocessableEntityException({
        path: 'email',
        message: 'Email đã tồn tại',
      })
    }

    //2. Nếu chưa thì tạo 1 OTP và lưu vào DB
    const otp = generateOTP()
    const verificationCode = this.authRepository.createVerificationCode({
      ...body,
      code: otp,
      expiresAt: addMilliseconds(new Date(), ms(envConfig.OTP_EXPIRES_IN)),
    })

    //3. Gửi mã OTP vào email người dùng đăng ký
    const { error } = await this.emailService.sendOTP({
      email: body.email,
      code: otp,
    })

    if (error) {
      throw new UnprocessableEntityException([
        {
          message: 'Gửi mã OTP thất bại',
          path: 'code',
        },
      ])
    }
    return {
      message: `Đã gửi mã OTP đến email ${body.email}`,
    }
  }

  async login(body: LoginBodyType & { userAgent: string; ip: string }) {
    const user = await this.authRepository.findUniqueUserIncludeRole({
      email: body.email,
    })

    if (!user) {
      throw new UnprocessableEntityException([
        {
          message: 'Email không tồn tại',
          path: 'email',
        },
      ])
    }

    const isPasswordMatch = await this.hashingService.compare(body.password, user.password)
    if (!isPasswordMatch) {
      throw new UnprocessableEntityException([
        {
          message: 'Mật khẩu không chính xác',
          path: 'password',
        },
      ])
    }
    const device = await this.authRepository.createDevice({
      userId: user.id,
      userAgent: body.userAgent,
      ip: body.ip,
    })
    const tokens = await this.generateTokens({
      userId: user.id,
      deviceId: device.id,
      roleId: user.roleId,
      roleName: user.role.name,
    })
    return tokens
  }

  async generateTokens({ userId, deviceId, roleId, roleName }: AccessTokenPayloadCreate) {
    const [accessToken, refreshToken] = await Promise.all([
      this.tokenService.signAccessToken({
        userId,
        deviceId,
        roleId,
        roleName,
      }),
      this.tokenService.signRefreshToken({
        userId,
      }),
    ])
    const decodedRefreshToken = await this.tokenService.verifyRefreshToken(refreshToken)
    await this.authRepository.createRefreshToken({
      token: refreshToken,
      userId,
      expiresAt: new Date(decodedRefreshToken.exp * 1000),
      deviceId,
    })
    return { accessToken, refreshToken }
  }

  async refreshToken({ refreshToken, userAgent, ip }: RefreshTokenBodyType & { userAgent: string; ip: string }) {
    try {
      // 1. Kiểm tra refreshToken có hợp lệ không
      const { userId } = await this.tokenService.verifyRefreshToken(refreshToken)

      // 2. Kiểm tra refreshToken có tồn tại trong database không
      const refreshTokenInDb = await this.authRepository.findUniqueRefreshTokenIncludeUserRole({
        token: refreshToken,
      })

      if (!refreshTokenInDb) {
        // Trường hợp đã refresh token rồi, hãy thông báo cho user biết
        // refresh token đã được sử dụng
        throw new UnauthorizedException('Refresh token đã được sử dụng')
      }

      const {
        deviceId,
        user: {
          roleId,
          role: { name: roleName },
        },
      } = refreshTokenInDb
      //3. Cập nhật device

      const updateDevice = await this.authRepository.updateDevice(deviceId, {
        ip,
        userAgent,
      })

      // 4. Xóa refreshToken cũ
      const deleteRefreshToken = await this.authRepository.deleteRefreshToken({
        token: refreshToken,
      })

      // 5. Tạo mới accessToken và refreshToken
      const tokens = await this.generateTokens({ userId, roleId, roleName, deviceId })

      return tokens
    } catch (error) {
      if (error instanceof HttpException) {
        throw error
      }
      throw new UnauthorizedException()
    }
  }

  async logout(refreshToken: string): Promise<MessageResType> {
    try {
      await this.tokenService.verifyRefreshToken(refreshToken)

      const detetedRefreshToken = await this.authRepository.deleteRefreshToken({
        token: refreshToken,
      })

      await this.authRepository.updateDevice(detetedRefreshToken.deviceId, {
        isActive: false,
      })
      return {
        message: 'Đăng xuất thành công',
      }
    } catch (error) {
      // Trường hợp đã refresh token rồi, hãy thông báo cho user biết
      // refresh token của họ đã bị đánh cắp
      if (isNotFoundPrismaError(error)) {
        throw new UnauthorizedException('Refresh token đã được sử dụng')
      }
      throw new UnauthorizedException()
    }
  }
}
