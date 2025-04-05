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

        const info = await transporter.sendMail({
            from: `"Ridan Express" <${process.env.EMAIL_USER}>`,
            to: email,
            subject: 'Verify Your Email',
            html: `<p>Verify: <a href="http://localhost:3000/verify-email?token=${token}">Click Here</a></p>`
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