import { Injectable } from '@nestjs/common'
import { Resend } from 'resend'
import envConfig from 'src/shared/config'

@Injectable()
export class EmailService {
  private resend: Resend
  constructor() {
    this.resend = new Resend(envConfig.RESEND_API_KEY)
  }

  sendOTP(payload: { email: string; code: string }) {
    return this.resend.emails.send({
      from: 'Acme <onboarding@resend.dev>',
      to: ['dangphuoctai1997@gmail.com'],
      subject: 'OTP xác nhận đăng ký',
      html: `<strong>${payload.code}</strong>`,
    })
  }
}
