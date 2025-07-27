require("dotenv").config()
const nodemailer = require("nodemailer")

const transporter = nodemailer.createTransport({
    service: 'Gmail',
    host: 'smtp.gmail.com',
    port: 465, // Try both 465 and 587
    secure: true, // True for 465, false for 587
    auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASSWORD
    },
    tls: {
        rejectUnauthorized: false
    }
});

const sendVerificationEmail = async (email, token) => {
    const verificationUrl = `${process.env.CLIENT_URL}/verify-email?token=${token}`

    try {
        console.log("Attempting to send email to:", email)

        const emailTemplate = `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Verify Your Email</title>
    <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap');
        
        .email-container {
            font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        }
        
        .btn-primary:hover {
            background: #ea580c !important;
            transform: translateY(-1px);
        }
        
        @media only screen and (max-width: 600px) {
            .main-table {
                width: 100% !important;
                margin: 0 10px !important;
            }
            .content-padding {
                padding: 30px 25px !important;
            }
            .header-padding {
                padding: 35px 25px 20px !important;
            }
        }
    </style>
</head>
<body style="margin:0; padding:0; font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%); min-height: 100vh;">
    <div class="email-container">
        <table width="100%" cellpadding="0" cellspacing="0" border="0" style="background: linear-gradient(135deg, #fff7ed 0%, #fed7aa 100%); min-height: 100vh;">
            <tr>
                <td align="center" style="padding: 50px 20px;">
                    <!-- Main Card -->
                    <table class="main-table" width="100%" style="max-width: 600px;" cellpadding="0" cellspacing="0" border="0" bgcolor="#ffffff" style="border-radius: 16px; box-shadow: 0 20px 40px rgba(234, 88, 12, 0.1), 0 8px 16px rgba(0,0,0,0.05); border: 1px solid rgba(251, 146, 60, 0.1); overflow: hidden;">
                        
                        <!-- Header -->
                        <tr>
                            <td class="header-padding" align="center" style="padding: 45px 35px 25px; background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); position: relative;">
                                <!-- Logo/Brand -->
                                <div style="background: rgba(255,255,255,0.15); padding: 12px 24px; border-radius: 50px; display: inline-block; margin-bottom: 20px;">
                                    <h2 style="margin: 0; font-size: 24px; font-weight: 700; color: #ffffff; letter-spacing: -0.5px;">
                                        Ridan Express
                                    </h2>
                                </div>
                                
                                <!-- Decorative Elements -->
                                <div style="position: absolute; top: 20px; right: 30px; width: 60px; height: 60px; background: rgba(255,255,255,0.1); border-radius: 50%; opacity: 0.6;"></div>
                                <div style="position: absolute; bottom: 15px; left: 25px; width: 40px; height: 40px; background: rgba(255,255,255,0.08); border-radius: 50%;"></div>
                                
                                <!-- Divider -->
                                <div style="height: 3px; background: rgba(255,255,255,0.3); margin: 25px auto 0; width: 60px; border-radius: 2px;"></div>
                            </td>
                        </tr>
                        
                        <!-- Content -->
                        <tr>
                            <td class="content-padding" style="padding: 50px 40px;">
                                <!-- Icon -->
                                <div style="text-align: center; margin-bottom: 30px;">
                                    <div style="display: inline-block; width: 80px; height: 80px; background: linear-gradient(135deg, #fed7aa 0%, #fdba74 100%); border-radius: 50%; position: relative;">
                                        <div style="position: absolute; top: 50%; left: 50%; transform: translate(-50%, -50%); font-size: 36px;">
                                            ✉️
                                        </div>
                                    </div>
                                </div>
                                
                                <h1 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: #1a1a1a; text-align: center; line-height: 1.3; letter-spacing: -0.5px;">
                                    Verify Your Email Address
                                </h1>
                                
                                <p style="font-size: 17px; line-height: 1.6; color: #525252; margin-bottom: 35px; text-align: center; font-weight: 400;">
                                    Welcome to <strong style="color: #ea580c;">Ridan Express</strong>! We're excited to have you on board. To complete your registration and unlock all features, please verify your email address.
                                </p>
                                
                                <!-- CTA Button -->
                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                    <tr>
                                        <td align="center" style="padding: 25px 0 35px;">
                                            <a href="${verificationUrl}" 
                                               class="btn-primary"
                                               style="display: inline-block; 
                                                      background: linear-gradient(135deg, #f97316 0%, #ea580c 100%); 
                                                      color: white; 
                                                      text-decoration: none;
                                                      font-weight: 600; 
                                                      font-size: 16px; 
                                                      padding: 18px 45px; 
                                                      border-radius: 12px;
                                                      box-shadow: 0 8px 20px rgba(234, 88, 12, 0.3), 0 4px 8px rgba(0,0,0,0.1);
                                                      transition: all 0.3s ease;
                                                      letter-spacing: 0.5px;
                                                      text-transform: uppercase;
                                                      font-size: 14px;">
                                                🔐 Verify Email Address
                                            </a>
                                        </td>
                                    </tr>
                                </table>
                                
                                <!-- Security Notice -->
                                <div style="background: #fef3c7; border: 1px solid #fbbf24; border-radius: 12px; padding: 20px; margin-bottom: 25px;">
                                    <p style="font-size: 14px; line-height: 1.5; color: #92400e; text-align: center; margin: 0; font-weight: 500;">
                                        🔒 <strong>Security Notice:</strong> This verification link will expire in 24 hours for your protection.
                                    </p>
                                </div>
                                
                            </td>
                        </tr>
                        
                        <!-- Footer -->
                        <tr>
                            <td style="padding: 35px 40px; background: linear-gradient(135deg, #fef7f0 0%, #fed7aa 100%); border-top: 1px solid rgba(251, 146, 60, 0.2);">
                                <table width="100%" cellpadding="0" cellspacing="0" border="0">
                                    <tr>
                                        <td align="center">
                                            <!-- Social Links -->
                                            <div style="margin-bottom: 25px;">
                                                <a href="#" style="display: inline-block; margin: 0 8px; width: 40px; height: 40px; background: #f97316; border-radius: 50%; text-align: center; line-height: 40px; color: white; text-decoration: none; font-size: 16px;">📧</a>
                                                <a href="#" style="display: inline-block; margin: 0 8px; width: 40px; height: 40px; background: #f97316; border-radius: 50%; text-align: center; line-height: 40px; color: white; text-decoration: none; font-size: 16px;">🌐</a>
                                                <a href="#" style="display: inline-block; margin: 0 8px; width: 40px; height: 40px; background: #f97316; border-radius: 50%; text-align: center; line-height: 40px; color: white; text-decoration: none; font-size: 16px;">📱</a>
                                            </div>
                                            
                                            <p style="font-size: 14px; color: #a3a3a3; margin: 0 0 15px; font-weight: 500;">
                                                &copy; ${new Date().getFullYear()} Ridan Express. All rights reserved.
                                            </p>
                                            
                                            <p style="font-size: 14px; color: #737373; margin: 0 0 20px;">
                                                <a href="https://ridanexpress.com" style="color: #ea580c; text-decoration: none; font-weight: 500;">Visit Our Website</a>
                                                <span style="color: #d4d4d4; margin: 0 12px;">•</span>
                                                <a href="mailto:support@ridanexpress.com" style="color: #ea580c; text-decoration: none; font-weight: 500;">Contact Support</a>
                                                <span style="color: #d4d4d4; margin: 0 12px;">•</span>
                                                <a href="#" style="color: #ea580c; text-decoration: none; font-weight: 500;">Privacy Policy</a>
                                            </p>
                                            
                                            <p style="font-size: 13px; color: #a3a3a3; margin: 0; line-height: 1.4;">
                                                📍 123 Business Avenue, Suite 100<br>
                                                City, ST 12345, United States
                                            </p>
                                        </td>
                                    </tr>
                                </table>
                            </td>
                        </tr>
                    </table>
                    
                    <!-- Sub-footer -->
                    <table width="100%" style="max-width: 600px;" cellpadding="0" cellspacing="0" border="0" style="margin-top: 25px;">
                        <tr>
                            <td align="center">
                                <p style="font-size: 12px; color: #a3a3a3; line-height: 1.4; margin: 0;">
                                    🔐 This email contains sensitive information. Please do not forward it to others.<br>
                                    If you didn't request this verification, you can safely ignore this email.
                                </p>
                            </td>
                        </tr>
                    </table>
                </td>
            </tr>
        </table>
    </div>
</body>
</html>`

        const info = await transporter.sendMail({
            from: `"Ridan Express" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: "🔐 Verify Your Email - Ridan Express",
            html: emailTemplate,
        })

        console.log("Email sent:", info.messageId)
        return true
    } catch (error) {
        console.error("Email Error Details:", {
            error: error.message,
            code: error.code,
            response: error.response,
            stack: error.stack,
        })
        throw error
    }
}

module.exports = sendVerificationEmail
