import nodemailer from 'nodemailer';
import { buildEmailBody } from '../utils/template.utils';

const transporter = nodemailer.createTransport({
    host: process.env.ZOHO_HOST,
    auth: {
        user: process.env.ZOHO_USER,
        pass: process.env.ZOHO_PASS,
    },
    port: Number(process.env.ZOHO_PORT),
    secure: true, // true for port 465, false for port 587
    // tls: {
    //     rejectUnauthorized: false,
    // },
    // requireTLS: true,
    // requireAuthentication: true,
});

export const EmailService = {
    async sendApplyingEmail(to: string, applicantName: string) {
        try {
            const { html, attachments } = await buildEmailBody("applying.docx", { applicant: applicantName });

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'You have successfully submitted your ACS job application',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Phone Interview email:', error);
        }
    },
    async sendCvScreeningEmail(to: string, applicantName: string) {
        try {
            const { html, attachments } = await buildEmailBody("cv_screening.docx", { applicant: applicantName });

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'Your application is in Review',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Phone Interview email:', error);
        }
    },
    async sendPhoneInterviewEmail(to: string, applicantName: string, date: string, time: string, link: string) {
        try {
            const { html, attachments } = await buildEmailBody("phone_interview.docx", { applicant: applicantName, date: date, time: time, link: link });

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'Online Interview Confirmation – Advanced Control Systems ',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Phone Interview email:', error);
        }
    },
    async sendWaitingListEmail(to: string, applicantName: string) {
        try {
            const { html, attachments } = await buildEmailBody("waiting_list.docx", { applicant: applicantName });

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'Feedback (Waiting list) – Advanced Control Systems',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Waiting List email:', error);
        }
    },
    async sendRejectionEmail(to: string, applicantName: string) {
        try {
            const { html, attachments } = await buildEmailBody("rejection.docx", { applicant: applicantName });

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'Feedback Interview (Rejection) – Advanced Control Systems ',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Rejection email:', error);
        }
    },
    async sendFinalInterviewEmail(to: string, applicantName: string,date: string, time: string) {
        try {
            const { html, attachments } = await buildEmailBody("final_interview.docx", { applicant: applicantName, date: date, time: time });

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'Final Interview Confirmation – Advanced Control Systems ',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Final Interview email:', error);
        }
    },
    async sendAcceptanceEmail(to: string, applicantName: string) {
        try {
            const { html, attachments } = await buildEmailBody("acceptance.docx", { applicant: applicantName});

            await transporter.sendMail({
                from: `"Advanced Control Systems" <${process.env.ZOHO_USER}>`,
                to: to,
                subject: 'Feedback (Acceptance) – Advanced Control Systems',
                html: html,
                attachments: attachments,
            });

        } catch (error) {
            console.error('❌ Error sending Acceptance email:', error);
        }
    },
};