import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};

export async function hashPassword(plain) {
  return argon2.hash(plain, ARGON2_OPTIONS);
}

export async function verifyPassword(hash, plain) {
  try {
    return await argon2.verify(hash, plain, ARGON2_OPTIONS);
  } catch (error) {
    return false;
  }
}
