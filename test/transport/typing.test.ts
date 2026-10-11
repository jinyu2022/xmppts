import { describe, expect, it } from "vitest";
import { Status } from "../../lib/transport/typing";

/**
 * 传输层状态常量测试：值与文档化状态机一致且互不重复。
 */
describe("Status", () => {
  it("与文档化状态机逐值一致", () => {
    expect(Status).toEqual({
      DISCONNECTED: 0,
      CONNECTING: 1,
      CONNECTED: 2,
      STREAM_START: 3,
      STREAM_ESTABLISHED: 4,
      STARTTLS: 5,
      TLS_ESTABLISHED: 6,
      AUTHENTICATING: 7,
      AUTHENTICATED: 8,
      BINDING: 9,
      BINDED: 10,
      AUTHFAIL: 11,
      SESSIONSTART: 12,
      RECONNECTING: 13,
      DISCONNECTING: 40,
      ERROR: 41,
      TIMEOUT: 42,
      SESSIONEND: 43,
    });
  });

  it("各状态取值唯一", () => {
    const values = Object.values(Status);
    expect(new Set(values).size).toBe(values.length);
  });
});
