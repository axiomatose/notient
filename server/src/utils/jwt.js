import jwt from "jsonwebtoken";
import { HttpError } from "../errors.js";

const JWT_ISSUER = "notient-api";
const JWT_AUDIENCE = "notient-clients";

export function signAuthToken({ userId, deviceId }, config) {
  return jwt.sign(
    { deviceId },
    config.jwtSecret,
    {
      subject: userId,
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
      expiresIn: config.jwtExpiresIn,
    },
  );
}

export function verifyAuthToken(token, config) {
  try {
    return jwt.verify(token, config.jwtSecret, {
      issuer: JWT_ISSUER,
      audience: JWT_AUDIENCE,
    });
  } catch (error) {
    throw new HttpError(401, "Invalid or expired token", "invalid_token");
  }
}
