import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

export const generate2FASecret = async (email: string) => {
    const secret = generateSecret();
    const otpauth = generateURI({
        issuer: 'ACS Portal',
        label: email,
        secret
    });
    const qrCodeDataURL = await QRCode.toDataURL(otpauth);
    return { secret, qrCodeDataURL };
};

export const verify2FAToken = async (token: string, secret: string) => {
    const result = await verify({ token, secret });
    return result.valid;
};
