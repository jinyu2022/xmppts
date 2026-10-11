import log from 'loglevel';

/** 增强标记，Symbol.for 走全局符号注册表，重复打包的副本之间共享 */
const ENHANCED = Symbol.for('xmppts.log.enhanced');

// 幂等：模块被重复求值时只有首个副本生效，避免前缀叠加
if (!(ENHANCED in log)) {
  // 保存原始的 methodFactory
  const originalMethodFactory = log.methodFactory;

  /** 在原始日志方法前加 `YYYY-MM-DD HH:mm:ss [LEVEL][logger]` 前缀 */
  const customMethodFactory: log.MethodFactory = function (
    this: log.Logger,
    methodName,
    level,
    loggerName
  ) {
    // 前缀对该 logger 的该级别固定不变，只在工厂调用时算一次
    const prefix = `[${methodName.toUpperCase()}]${loggerName ? `[${String(loggerName)}]` : ''}`;
    const originalMethod = originalMethodFactory.call(this, methodName, level, loggerName);

    // 本工厂只对启用级别调用；禁用级别由 loglevel 直接赋 noop，不进此处
    return function (...args: unknown[]): void {
      // 实参为函数时按 thunk 求值；禁用级别该函数不被调用，闭包体不执行，即惰性所在
      for (let i = 0; i < args.length; i++) {
        if (typeof args[i] === 'function') {
          args[i] = (args[i] as () => unknown)();
        }
      }
      // 本地时区 YYYY-MM-DD HH:mm:ss；时间取 toTimeString 前 8 位，避免 toLocaleTimeString 的 locale 差异
      const now = new Date();
      const ymd = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
      const stamp = `${ymd} ${now.toTimeString().slice(0, 8)}`;
      const head = `${stamp} ${prefix}`;
      // 首参为字符串时拼进格式串，保留 console 的 %s/%d/%o 占位符
      if (typeof args[0] === 'string') {
        args[0] = `${head} ${args[0]}`;
        originalMethod(...args);
      } else {
        originalMethod(head, ...args);
      }
    };
  };

  Object.defineProperty(log, ENHANCED, { value: true });
  log.methodFactory = customMethodFactory;
  // 赋值不会刷新已生成的日志方法，需显式重建
  log.rebuild();
}

export const logger = log;
export default logger;