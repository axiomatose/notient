import { HttpError } from "../errors.js";
import { verifyAuthToken } from "../utils/jwt.js";

export function createAuthMiddleware({ config, repos }) {
  return function requireAuth(req, res, next) {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.toLowerCase().startsWith("bearer ")) {
      next(new HttpError(401, "Authorization header missing", "missing_token"));
      return;
    }

    const token = authHeader.slice("bearer ".length).trim();
    if (!token) {
      next(new HttpError(401, "Authorization header missing", "missing_token"));
      return;
    }

    let payload;
    try {
      payload = verifyAuthToken(token, config);
    } catch (error) {
      next(error);
      return;
    }

    const userId = payload.sub;
    const deviceId = payload.deviceId;
    if (!userId || !deviceId) {
      next(new HttpError(401, "Invalid token payload", "invalid_token_payload"));
      return;
    }

    const userRecord = repos.users.findById(userId);
    if (!userRecord) {
      next(new HttpError(401, "User not found", "user_not_found"));
      return;
    }

    const deviceRecord = repos.devices.findById(deviceId);
    if (!deviceRecord || deviceRecord.user_id !== userRecord.id) {
      next(new HttpError(401, "Device not recognized", "device_not_recognized"));
      return;
    }

    const { password_hash, ...user } = userRecord;
    const { user_id, ...device } = deviceRecord;

    req.auth = {
      user,
      device,
      userId,
      deviceId,
    };

    next();
  };
}
