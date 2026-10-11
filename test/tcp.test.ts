import { describe, it, expect } from "vitest";
import XMPPConnection from "../lib/transport/tcp";
import { JID } from "../lib/JID";
import { Status } from "../lib/transport/typing";
import logger from "../lib/log";
logger.setLevel("debug");
// 占位符：请替换为您的真实 XMPP 账号信息
/** 您的 XMPP JID，例如 "user@example.com" */
const TEST_JID_STRING = "PLACEHOLDER_USER@example.com";
/** 您的 XMPP 密码 */
const TEST_PASSWORD = "PLACEHOLDER_PASSWORD";
/** XMPP 服务器的连接 URL，如果留空则使用 SRV 记录解析 */
const TEST_SERVER_URL = "";

describe("XMPPConnection TCP/TLS 连接测试", () => {
  // 需真实账号与外网，默认跳过；填入下方账号后去掉 .skip 手动运行
  it.skip("应该能够成功连接到 XMPP 服务器", async () => {
    // 检查占位符是否已被替换
    if (
      TEST_JID_STRING.includes("PLACEHOLDER") ||
      TEST_PASSWORD.includes("PLACEHOLDER")
    ) {
      console.warn(
        "警告：请在测试文件 tcp.test.ts 中替换占位符 TEST_JID_STRING 和 TEST_PASSWORD 为您的真实账号信息。",
      );
      return;
    }

    const jid = new JID(TEST_JID_STRING);
    const connection = new XMPPConnection(jid, TEST_PASSWORD, true); // 默认使用 TLS

    // 使用 Promise 包装 connect 事件，以便等待连接完成
    const connectPromise = new Promise<void>((resolve, reject) => {
      connection.once("binded", () => {
        resolve();
      });
      connection.once("error", (error) => {
        reject(error);
      });
      connection.once("close", () => {
        reject(new Error("连接意外断开"));
      });
    });
    connection.on("stanza", (stanza) => {
      console.log("收到 stanza:", stanza.toXMLString());
    });
    // 开始连接
    void connection.connect(TEST_SERVER_URL);

    // 等待连接成功
    await expect(connectPromise).resolves.toBeUndefined();

    // 验证连接状态
    expect(connection.status).toBeGreaterThanOrEqual(Status.CONNECTED);

    // 清理：断开连接
    connection.disconnect();
  }, 5000); // 设置较长的超时时间以应对网络延迟
});
