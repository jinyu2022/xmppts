import RFC6121 from "./rfc6121";
import XEP0004 from "./xep0004";
import XEP0030 from "./xep0030";
import XEP0045 from "./xep0045";
import XEP0060 from "./xep0060";
import XEP0084 from "./xep0084";
import XEP0115 from "./xep0115";
import XEP0156 from "./xep0156";
import XEP0163 from "./xep0163";
import XEP0172 from "./xep0172";
import XEP0184 from "./xep0184";
import XEP0198 from "./xep0198";
import XEP0199 from "./xep0199";
import XEP0203 from "./xep0203";
import XEP0280 from "./xep0280";
import XEP0297 from "./XEP0297";
import XEP0308 from "./xep0308";
import XEP0359 from "./xep0359";
import XEP0368 from "./xep0368";
import XEP0402 from "./xep0402";
import XEP0410 from "./xep0410";
import XEP0424 from "./xep0424";
import XEP0425 from "./xep0425";
import XEP0486 from "./xep0486";
// import type { PluginConstructor } from "./types";

export {
  RFC6121,
  XEP0004,
  XEP0030,
  XEP0045,
  XEP0060,
  XEP0084,
  XEP0115,
  XEP0156,
  XEP0163,
  XEP0172,
  XEP0184,
  XEP0198,
  XEP0199,
  XEP0203,
  XEP0280,
  XEP0297,
  XEP0308,
  XEP0359,
  XEP0368,
  XEP0402,
  XEP0410,
  XEP0424,
  XEP0425,
  XEP0486,
};

export const pluginLoaders = {
  RFC6121: () => import("./rfc6121").then((mod) => mod.default),
  XEP0004: () => import("./xep0004").then((mod) => mod.default),
  XEP0030: () => import("./xep0030").then((mod) => mod.default),
  XEP0045: () => import("./xep0045").then((mod) => mod.default),
  XEP0060: () => import("./xep0060").then((mod) => mod.default),
  XEP0084: () => import("./xep0084").then((mod) => mod.default),
  XEP0115: () => import("./xep0115").then((mod) => mod.default),
  XEP0156: () => import("./xep0156").then((mod) => mod.default),
  XEP0163: () => import("./xep0163").then((mod) => mod.default),
  XEP0172: () => import("./xep0172").then((mod) => mod.default),
  XEP0184: () => import("./xep0184").then((mod) => mod.default),
  XEP0198: () => import("./xep0198").then((mod) => mod.default),
  XEP0199: () => import("./xep0199").then((mod) => mod.default),
  XEP0203: () => import("./xep0203").then((mod) => mod.default),
  XEP0280: () => import("./xep0280").then((mod) => mod.default),
  XEP0297: () => import("./XEP0297").then((mod) => mod.default),
  XEP0308: () => import("./xep0308").then((mod) => mod.default),
  XEP0359: () => import("./xep0359").then((mod) => mod.default),
  XEP0368: () => import("./xep0368").then((mod) => mod.default),
  XEP0402: () => import("./xep0402").then((mod) => mod.default),
  XEP0410: () => import("./xep0410").then((mod) => mod.default),
  XEP0424: () => import("./xep0424").then((mod) => mod.default),
  XEP0425: () => import("./xep0425").then((mod) => mod.default),
  XEP0486: () => import("./xep0486").then((mod) => mod.default),
} as const
