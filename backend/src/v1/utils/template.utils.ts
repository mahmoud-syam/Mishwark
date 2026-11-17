import mammoth from 'mammoth';
import path from 'path';

export async function buildEmailBody(templateName: string, variables: Record<string, string>) {
    try {
        // 1. Resolve paths
        const templatePath = path.join(__dirname, '../..', 'templates', templateName);
        const signatureImagePath = path.join(__dirname, '../..', 'templates', 'acs_sig.png');
        const signatureCid = 'acs-signature-logo';

        // 2. Tell Mammoth to map your custom Word style to a specific CSS class
        const options = {
            styleMap: [
                "p[style-name='IndentedText'] => p.custom-indent"
            ]
        };

        // 3. Convert Word to HTML
        const result = await mammoth.convertToHtml({ path: templatePath }, options);
        let htmlBody = result.value; 

        // 4. Force the indentation using inline CSS
        htmlBody = htmlBody.replace(/<p class="custom-indent">/g, '<p style="margin-left: 40px; margin-bottom: 10px;">');

        // 5. Replace variables like {{date}} and {{time}}
        for (const [key, value] of Object.entries(variables)) {
            const placeholder = new RegExp(`{{${key}}}`, 'g');
            htmlBody = htmlBody.replace(placeholder, value);
        }

        // 6. Define the perfectly styled HTML signature
        const signatureHtml = `
            <br>
            <div style="font-family: Arial, Helvetica, sans-serif; font-size: 14px; color: #333333; margin-top: 20px;">
                <p style="margin: 0 0 4px 0;"><strong>HR Department</strong></p>
                <p style="margin: 0 0 4px 0; font-size: 16px; color: #E35205;"><strong>Advanced Control Systems</strong></p>
                
                <p style="margin: 0 0 4px 0;">
                    <strong>Mobile:</strong> <a href="tel:01281342696" style="color: #333333; text-decoration: none;">01281342696</a>
                </p>
                <p style="margin: 0 0 4px 0;">
                    <strong>Website:</strong> <a href="https://www.advcontrolsys.com" style="color: #0056b3; text-decoration: underline;">https://www.advcontrolsys.com</a>
                </p>
                <p style="margin: 0 0 15px 0;">
                    17 Hassan Sadek Street - Behind Baron Palace<br>
                    Heliopolis - Cairo - Egypt
                </p>
                
                <img src="cid:${signatureCid}" alt="Advanced Control Systems Partner Badges" style="max-width: 500px; height: auto; border: none; display: block;">
            </div>
        `;

        // 7. Create the attachment array for the embedded image
        const attachments = [
            {
                filename: 'acs_sig.png',
                path: signatureImagePath,
                cid: signatureCid 
            }
        ];

        // 8. Return the complete package for Nodemailer
        return {
            html: htmlBody + signatureHtml,
            attachments: attachments
        };

    } catch (error) {
        console.error(`❌ Error building template ${templateName}:`, error);
        throw new Error('Failed to build email template');
    }
}