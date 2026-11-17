import { generateSecret, generateURI, verify } from 'otplib';
import QRCode from 'qrcode';

export const generate2FASecret = async (email: string) => {
    const secret = generateSecret();
    const otpauth = generateURI({
        issuer: 'Mishwark',
        label: email,
        secret
    });
    const qrCodeDataURL = await QRCode.toDataURL(otpauth);
    return { secret, qrCodeDataURL };
};

/** False for a wrong code, and also for a malformed secret or code (otplib throws on those). */
export const verify2FAToken = async (token: string, secret: string) => {
    try {
        const result = await verify({ token, secret });
        return result.valid;
    } catch {
        return false;
    }
};
