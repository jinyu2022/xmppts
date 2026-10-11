import { describe, it, expect } from "vitest";
import { fileURLToPath } from "node:url";
import { MUCAvatars } from "../../../lib/plugins/xep0486/MUCAvatars";

/**
 * XEP-0486: MUC Avatars
 * @see https://xmpp.org/extensions/xep-0486.html
 * @version 0.1.0 (2024-03-10)
 *
 * 头像通过 vCard-temp（XEP-0054）在群聊中设置/获取，是 XEP-0153 在 MUC 场景的特化。
 * 用例取自规范 §3.2 Example 3（发布带 PHOTO 的 vCard）、§3.2 Example 8（空 vCard 删除头像）、
 * §3.4 Example 11（get 获取 vCard），房 JID 采用规范中的 garden@chat.shakespeare.example.org。
 */
describe("MUCAvatars", () => {
  describe("createSetAvatarIq", () => {
    it("不传 image 时生成删除头像的 set IQ（§3.2 Example 8）", async () => {
      const result = await MUCAvatars.createSetAvatarIq("garden@chat.shakespeare.example.org");
      const vCard = result.getElementsByTagName("vCard")[0];
      expect({
        type: result.getAttribute("type"),
        to: result.getAttribute("to"),
        vCardNs: vCard.namespaceURI,
        vCardChildren: vCard.children.length,
      }).toEqual({
        type: "set",
        to: "garden@chat.shakespeare.example.org",
        vCardNs: "vcard-temp",
        vCardChildren: 0,
      });
    });

    it("传入 image 时在 vCard 内生成 PHOTO/TYPE/BINVAL（§3.2 Example 3）", async () => {
      const filePath = fileURLToPath(new URL("../xep0084/xmpp.png", import.meta.url));
      const result = await MUCAvatars.createSetAvatarIq(
        "garden@chat.shakespeare.example.org",
        filePath
      );
      const vCard = result.getElementsByTagName("vCard")[0];
      const photo = vCard.getElementsByTagName("PHOTO")[0];
      const type = photo.getElementsByTagName("TYPE")[0];
      const binval = photo.getElementsByTagName("BINVAL")[0];
      expect({
        iqType: result.getAttribute("type"),
        vCardNs: vCard.namespaceURI,
        type: type.textContent,
        binvalEmpty: binval.textContent.length === 0,
      }).toEqual({
        iqType: "set",
        vCardNs: "vcard-temp",
        type: "image/png",
        binvalEmpty: false,
      });
    });
  });

  describe("createGetAvatarIq", () => {
    it("生成获取头像的 get IQ（§3.4 Example 11）", () => {
      const iq = MUCAvatars.createGetAvatarIq("garden@chat.shakespeare.example.org");
      const vCard = iq.getElementsByTagName("vCard")[0];
      expect({
        type: iq.getAttribute("type"),
        to: iq.getAttribute("to"),
        vCardNs: vCard.namespaceURI,
      }).toEqual({
        type: "get",
        to: "garden@chat.shakespeare.example.org",
        vCardNs: "vcard-temp",
      });
    });
  });
});
