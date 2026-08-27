import { hash, verify, type Options } from "@node-rs/argon2";

const ARGON2_OPTS: Options = {
  algorithm: 2 as Options["algorithm"], // Algorithm.Argon2id（避免 isolatedModules 下访问 const enum）
  memoryCost: 19456, // 19 MiB，OWASP 建议档位
  timeCost: 2,
  parallelism: 1,
};

export async function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON2_OPTS);
}

export async function verifyPassword(
  hashed: string,
  password: string,
): Promise<boolean> {
  try {
    return await verify(hashed, password, {
      algorithm: 2 as Options["algorithm"],
    });
  } catch {
    return false;
  }
}

/** 生成初始密码：足够随机、人类可抄写（去掉易混淆字符） */
export function generateInitialPassword(length = 14): string {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (n) => alphabet[n % alphabet.length]).join("");
}
