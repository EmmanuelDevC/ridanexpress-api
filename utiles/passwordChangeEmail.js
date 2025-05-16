// utils/passwordChangeEmail.js
const nodemailer = require('nodemailer');
require('dotenv').config();

// Create reusable transporter
const transporter = nodemailer.createTransport({
  service: 'Gmail',
  host: 'smtp.gmail.com',
  port: 465,
  secure: true,
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASSWORD
  }
});

module.exports = async ({ email, name, resetLink }) => {
  const htmlContent = `
  <div style="max-width: 600px; margin: 0 auto; font-family: Arial, sans-serif;">
    <div style="background: #fff8f0; padding: 30px; border-radius: 10px;">
      <h2 style="color: #d63638;">Security Alert: Password Changed</h2>
      <p>Hello ${name},</p>
      <p>Your Ridan Express account password was changed on ${new Date().toLocaleString()}.</p>
      
      <div style="background: #fff3e0; padding: 20px; border-radius: 8px; margin: 25px 0;">
        <p>If you didn't make this change:</p>
        <a href="${resetLink}" 
           style="background: #d63638; color: white; padding: 12px 24px; 
                  border-radius: 5px; text-decoration: none; display: inline-block;
                  margin-top: 15px;">
          Reset Password Now
        </a>
        <p style="font-size: 12px; color: #666; margin-top: 15px;">
          Link expires in 15 minutes
        </p>
      </div>
      
      <div style="margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee;">
        <p style="font-size: 12px; color: #666;">
          This is an automated message. Please do not reply directly to this email.
        </p>
      </div>
    </div>
  </div>
  `;

  try {
    await transporter.sendMail({
      from: `"Ridan Express Security" <${process.env.EMAIL_USER}>`,
      to: email,
      subject: 'Important: Password Change Alert',
      html: htmlContent
    });
    console.log('Password change email sent to:', email);
  } catch (error) {
    console.error('Password Change Email Error:', error);
    throw new Error('Failed to send security alert email');
  }
};