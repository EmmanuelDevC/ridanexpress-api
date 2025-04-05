require('dotenv').config();
const nodemailer = require('nodemailer');

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
    try {
        console.log('Attempting to send email to:', email);

        const emailTemplate = `
        <div style="
            max-width: 600px;
            margin: 0 auto;
            padding: 20px;
            font-family: Arial, sans-serif;
            color: #333;
            border: 1px solid #eee;
            border-radius: 10px;
        ">
            <div style="
                text-align: center;
                padding: 20px;
                background-color: #f8f9fa;
                border-radius: 10px 10px 0 0;
            ">
                <img src="https://via.placeholder.com/150x50?text=Ridan+Express" alt="Ridan Express Logo" style="max-width: 200px;">
            </div>

            <div style="padding: 30px 20px;">
                <h1 style="color: #2c3e50; text-align: center; margin-bottom: 30px;">Verify Your Email Address</h1>
                
                <p style="font-size: 16px; line-height: 1.6; margin-bottom: 25px;">
                    Thanks for joining Ridan Express! To complete your registration, please verify your email address by clicking the button below:
                </p>

                <div style="text-align: center; margin: 40px 0;">
                    <a href="https://ridan-express-client.vercel.app/verify-email?token=${token}" 
                       style="
                           background-color: #3498db;
                           color: white;
                           padding: 15px 30px;
                           text-decoration: none;
                           border-radius: 5px;
                           font-weight: bold;
                           display: inline-block;
                           transition: background-color 0.3s;
                       "
                       onmouseover="this.style.backgroundColor='#2980b9'" 
                       onmouseout="this.style.backgroundColor='#3498db'">
                        Verify Email Address
                    </a>
                </div>

                <p style="font-size: 14px; color: #666; line-height: 1.6;">
                    If you didn't create an account with Ridan Express, you can safely ignore this email. 
                    This link will expire in 24 hours.
                </p>
            </div>

            <div style="
                background-color: #f8f9fa;
                padding: 20px;
                text-align: center;
                border-radius: 0 0 10px 10px;
                font-size: 12px;
                color: #666;
            ">
                <p>© ${new Date().getFullYear()} Ridan Express. All rights reserved.</p>
                <p>Need help? Contact us at <a href="mailto:support@ridanexpress.com" style="color: #3498db; text-decoration: none;">support@ridanexpress.com</a></p>
            </div>
        </div>
        `;

        const info = await transporter.sendMail({
            from: `"Ridan Express" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify Your Email',
            html: emailTemplate
        });

        console.log('Email sent:', info.messageId);
        return true;
    } catch (error) {
        console.error('Email Error Details:', {
            error: error.message,
            code: error.code,
            response: error.response,
            stack: error.stack
        });
        throw error;
    }
};

module.exports = sendVerificationEmail;