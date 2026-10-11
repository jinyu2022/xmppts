import { describe, it, expect } from "vitest";
import { StreamManagement } from "../../../lib/plugins/xep0198/streamManagement";

/**
 * XEP-0198: Stream Management
 * @see https://xmpp.org/extensions/xep-0198.html
 * @version 1.6.3 (2025-07-28)
 *
 * 命名空间取自 §12.1 Protocol Namespaces（urn:xmpp:sm:3）。
 */
describe("StreamManagement", () => {
  describe("NS", () => {
    it("命名空间（§12.1 Protocol Namespaces）", () => {
      expect(StreamManagement.NS).toBe("urn:xmpp:sm:3");
    });
  });
});
