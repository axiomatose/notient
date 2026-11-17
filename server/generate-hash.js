import argon2 from "argon2";

const ARGON2_OPTIONS = {
  type: argon2.argon2id,
  memoryCost: 2 ** 16,
  timeCost: 3,
  parallelism: 1,
};

async function generateHash() {
  const hash = await argon2.hash("demo1234", ARGON2_OPTIONS);
  console.log("Argon2 hash for demo1234:");
  console.log(hash);
}

generateHash().catch(console.error);
