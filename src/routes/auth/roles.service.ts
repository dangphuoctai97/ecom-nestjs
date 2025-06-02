import { Injectable } from '@nestjs/common'
import { RoleName } from 'src/shared/constants/role.constant'
import { PrismaService } from 'src/shared/services/prisma.service'

@Injectable()
export class RolesService {
  private clientRoleId: number | null = null

  constructor(private readonly prismaService: PrismaService) {}
  //Mỗi khi khách hàng đăng kí, ta sẽ gán roldId là Client cho khách hàng
  //Để tránh trường hợp mỗi lần khách hàng đăng kí đều query tới DB để lấy roleId, ta sẽ cache clientRoleId
  //Chỉ query khi người dùng đầu tiên đăng ký, còn những lần sau sẽ lấy trong cache

  //Cache clientRoleId
  async getClientRoleId() {
    //Kiểm tra clientRoleid đã có chưa, có rồi thì return
    if (this.clientRoleId) {
      return this.clientRoleId
    }

    //Chưa có thì query tới DB để lấy ra
    const role = await this.prismaService.role.findUniqueOrThrow({
      where: {
        name: RoleName.Client,
      },
    })
    this.clientRoleId = role.id
    return role.id
  }
}
