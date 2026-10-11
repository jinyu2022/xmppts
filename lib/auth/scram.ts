import logger from "@/log";
const log = logger.getLogger("scram");
/**
 * 对两个 ArrayBuffer 进行异或运算
 * @param x 第一个 ArrayBuffer
 * @param y 第二个 ArrayBuffer
 * @returns 异或运算结果的新 ArrayBuffer
 */
function xorArrayBuffers(x: ArrayBufferLike, y: ArrayBufferLike): ArrayBuffer {
  // 将输入的 ArrayBuffer 转换为 Uint8Array 以便进行位运算
  const xIntArray = new Uint8Array(x);
  const yIntArray = new Uint8Array(y);
  // 创建新的 Uint8Array 用于存储结果
  const zIntArray = new Uint8Array(x.byteLength);

  // 逐字节进行异或运算
  for (let i = 0; i < x.byteLength; i++) {
    zIntArray[i] = xIntArray[i] ^ yIntArray[i];
  }

  // 返回结果的 ArrayBuffer
  return zIntArray.buffer;
}

/**
 * 将字符串转换为 ArrayBuffer
 */
function stringToArrayBuf(str: string) {
  const bytes = new TextEncoder().encode(str);
  return bytes.buffer;
}

function base64ToArrayBuf(str: string) {
  return Uint8Array.from(atob(str), (c) => c.charCodeAt(0)).buffer;
}

export function arrayBufToBase64(buf: ArrayBuffer) {
  return btoa(String.fromCharCode.apply(null, Array.from(new Uint8Array(buf))));
}
/**
 * 计算客户端证明 (client proof)
 * @param authMessage 认证消息
 * @param clientKey 客户端密钥
 * @param hashName 哈希算法名称
 * @returns 客户端证明
 */
export async function scramClientProof(
  authMessage: string,
  clientKey: ArrayBuffer,
  hashName: string
) {
  // 使用指定哈希算法处理客户端密钥
  const hashedKey = await crypto.subtle.digest(hashName, clientKey);
  // 导入处理后的密钥
  const storedKey = await crypto.subtle.importKey(
    "raw",
    hashedKey,
    { name: "HMAC", hash: hashName },
    false,
    ["sign"]
  );
  // 计算客户端签名
  const clientSignature = await crypto.subtle.sign(
    "HMAC",
    storedKey,
    stringToArrayBuf(authMessage)
  );

  // 计算并返回客户端证明
  return xorArrayBuffers(clientKey, clientSignature);
}

/**
 * 此函数将 SASL SCRAM 挑战响应中的信息解析为以下形式的对象，失败时返回 null
 * @example
 * {
 *   nonce: String,
 *   salt:  ArrayBuffer,
 *   iter:  Int
 * }
 */
export function scramParseChallenge(challenge: string) {
  // 初始化返回值
  let nonce: string | undefined;
  let salt: ArrayBuffer | undefined;
  let iter: number | undefined;

  // 匹配属性的正则表达式
  const ATTRIB_PATTERN = /([a-z]+)=([^,]+)(?:,|$)/;
  let remainingChallenge = challenge;

  // 逐个解析属性
  while (remainingChallenge.length > 0) {
    const matches = ATTRIB_PATTERN.exec(remainingChallenge);
    if (!matches) break;

    // 更新剩余字符串
    remainingChallenge = remainingChallenge.replace(matches[0], "");

    // 根据属性名称处理值
    switch (matches[1]) {
      case "r": // nonce
        nonce = matches[2];
        break;

      case "s": // salt
        salt = base64ToArrayBuf(matches[2]);
        break;

      case "i": // iteration count
        iter = parseInt(matches[2], 10);
        break;

      case "m": // mandatory extension
        log.warn("遇到未知的强制扩展，根据 RFC 5802 规范需要中止");
        return null;

      default: // optional extension
        // 非强制扩展，根据 RFC 5802 我们应该忽略它
        log.warn(`遇到未知的可选扩展，忽略它: ${matches[1]}=${matches[2]}`);
        break;
    }
  }

  // 验证必要字段
  if (!nonce) {
    log.warn("服务器未提供 nonce");
    return null;
  }

  if (!salt) {
    log.warn("服务器未提供有效的盐值");
    return null;
  }
  if (!iter) {
    log.warn("服务器未提供迭代次数");
    return null;
  }
  // RFC 5802 未强制客户端设阈值，小于 4096 仅告警不拒绝
  if (iter < 4096) {
    log.warn(`迭代次数 ${iter} 小于常见最小值 4096，继续认证`);
  }

  return { nonce, salt, iter };
}

/**
 * 给定字符串密码、哈希名称和位长度，派生客户端和服务器密钥。
 * 返回以下形式的对象：
 * @example
 * { ck: ArrayBuffer, // 客户端密钥
 *   sk: ArrayBuffer, // 服务器密钥
 * }
 * @param password 密码
 * @param salt 盐值
 * @param iter 迭代次数
 * @param hashName 哈希算法名称
 * @param hashBits 哈希算法位长度
 */
export async function scramDeriveKeys(
  password: string,
  salt: ArrayBuffer,
  iter: number,
  hashName: string,
  hashBits: number
) {
  const saltedPasswordBits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", salt: salt, iterations: iter, hash: { name: hashName } },
    await crypto.subtle.importKey(
      "raw",
      stringToArrayBuf(password),
      "PBKDF2",
      false,
      ["deriveBits"]
    ),
    hashBits
  );
  const saltedPassword = await crypto.subtle.importKey(
    "raw",
    saltedPasswordBits,
    { name: "HMAC", hash: hashName },
    false,
    ["sign"]
  );

  return {
    ck: await crypto.subtle.sign(
      "HMAC",
      saltedPassword,
      stringToArrayBuf("Client Key")
    ),
    sk: await crypto.subtle.sign(
      "HMAC",
      saltedPassword,
      stringToArrayBuf("Server Key")
    ),
  };
}

/**
 * 计算服务器签名
 * @param authMessage 认证消息
 * @param serverKey 服务器密钥
 * @param hashName 哈希算法名称 (如 'SHA-1', 'SHA-256' 等)
 */
export async function scramServerSign(
  authMessage: string,
  serverKey: ArrayBuffer,
  hashName: string
) {
  // 导入服务器密钥用于 HMAC 运算
  const importedServerKey = await crypto.subtle.importKey(
    "raw",
    serverKey,
    { name: "HMAC", hash: hashName },
    false,
    ["sign"]
  );

  // 使用 HMAC 计算服务器签名
  return crypto.subtle.sign(
    "HMAC",
    importedServerKey,
    stringToArrayBuf(authMessage)
  );
}

/**
 * 生成指定长度的随机数
 * @param length 需要的随机数长度，默认为 16
 * @returns 随机数
 */
export function generateSecureNonce(length: number = 16) {
  // 生成随机字节
  const array = new Uint8Array(length);
  // 转换为 base64 并移除特殊字符
  return arrayBufToBase64(crypto.getRandomValues(array).buffer)
}

/** 应对挑战
 * @param username 用户名
 * @param password 密码
 * @param challenge 挑战原文，不需要解码
 * @param mechanism 机制
 */
export async function scramResponse(
  password: string,
  challenge: string,
  clientFirstMessageBare: string,
  mechanism: "SCRAM-SHA-1"
) {
  const mechanismToHash = {
    "SCRAM-SHA-1": "SHA-1",
    // "SCRAM-SHA-256": "SHA-256",
  } as const;

  const hashName = mechanismToHash[mechanism];
  if (!hashName) throw new Error(`Unsupported mechanism: ${mechanism}`);
  const decodedChallenge = atob(challenge);
  const parsedChallenge = scramParseChallenge(decodedChallenge);
  if (!parsedChallenge) throw new Error("无法解析 SCRAM 挑战");
  
  const { nonce, salt, iter } = parsedChallenge;
  // RFC 5802 §5.1：客户端必须验证服务器 nonce 以客户端 nonce 开头，防中间人
  const clientNonce = /,r=([^,]+)$/.exec(clientFirstMessageBare)?.[1];
  if (clientNonce && !nonce.startsWith(clientNonce)) {
    throw new Error("服务器 nonce 未以客户端 nonce 开头");
  }
  const clientFinalMessageBare = `c=biws,r=${nonce}`;
  const authMessage = `${clientFirstMessageBare},${decodedChallenge},${clientFinalMessageBare}`;
  
  const hashLengthMap = {
    "SHA-1": 160,
    // "SHA-256": 256,
    // "SHA-384": 384,
    // "SHA-512": 512,
  } as const;

  const { ck, sk } = await scramDeriveKeys(password, salt, iter, hashName, hashLengthMap[hashName]);
  const [clientProof, serverProof] = await Promise.all([
    scramClientProof(authMessage, ck, hashName),
    scramServerSign(authMessage, sk, hashName)
  ]);
  return {
    clientResponse: btoa(`${clientFinalMessageBare},p=${arrayBufToBase64(clientProof)}`),
    serverProof: arrayBufToBase64(serverProof)
  }
}