import { Parser } from "../../ltx/Parser";
import { TimeoutError } from "@/errors";
import logger from "@/log";

const log = logger.getLogger("XEP0156");

interface ConnectionMethods {
  websocket?: string;
  httppoll?: string;
  xbosh?: string;
}

export class XMPPDiscoverer {
  static async discoverAltXMPP(
    domain: string,
    timeout = 5000
  ): Promise<ConnectionMethods> {
    const url = `https://${domain}/.well-known/host-meta`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);
    timeoutId.unref?.();

    try {
      const response = (await Promise.race([
        fetch(url, { signal: controller.signal }),
        new Promise((_, reject) => {
          setTimeout(() => reject(new TimeoutError("请求超时")), timeout).unref?.();
        }),
      ])) as Response;

      if (!response.ok) {
        throw new Error(`HTTP错误: ${response.status}`);
      }

      const text = await response.text();
      const doc = Parser.parse(text);
      const elements = doc.getElementsByTagName("Link");
      const result: ConnectionMethods = {};

      const REL_TO_KEY = {
        "urn:xmpp:alt-connections:websocket": "websocket",
        "urn:xmpp:alt-connections:httppoll": "httppoll",
        "urn:xmpp:alt-connections:xbosh": "xbosh",
      } as const;

      for (const element of elements) {
        const rel = element.getAttribute("rel");
        const href = element.getAttribute("href");
        if (rel && href) {
          if (rel in REL_TO_KEY) {
            const key = REL_TO_KEY[rel as keyof typeof REL_TO_KEY];
            result[key] = href;
          } else {
            log.warn(`发现未知的连接类型: ${rel}`);
          }
        }
      }

      return result;
    } finally {
      clearTimeout(timeoutId);
    }
  }
}
