import { describe, it, expect } from 'vitest';
import { XMPPElement } from '../../lib/ltx/Element';
import { Parser } from '../../lib/ltx/Parser';

describe('XMPPElement', () => {
  describe('createElement', () => {
    it('创建带名称的元素', () => {
      const el = XMPPElement.createElement('message');
      expect(el.tagName).toBe('message');
      expect(el.childNodes).toEqual([]);
      expect(el.getAttribute('xmlns')).toBeNull();
    });

    it('可选属性表写入属性', () => {
      const el = XMPPElement.createElement('message', { to: 'a@b', priority: 5 });
      expect(el.getAttribute('to')).toBe('a@b');
      expect(el.getAttribute('priority')).toBe('5');
    });
  });

  describe('createElementNS', () => {
    it('创建带命名空间与限定名的元素', () => {
        const el = XMPPElement.createElementNS('http://example.com', 'ns:message');
        expect(el.tagName).toBe('ns:message');
        expect(el.namespaceURI).toBe('http://example.com');
        expect(el.prefix).toBe('ns');
        expect(el.localName).toBe('message');
    });

    it('可选属性表写入属性', () => {
      const el = XMPPElement.createElementNS('http://example.com', 'ns:message', { id: '1' });
      expect(el.getAttribute('id')).toBe('1');
      expect(el.namespaceURI).toBe('http://example.com');
    });
  });

  describe('namespaceURI', () => {
    it('XML Namespaces §6.2：空默认命名空间只重置对应子树', () => {
      const root = Parser.parse(`
        <root xmlns="urn:example:outer" xmlns:p="urn:example:prefix">
          <plain xmlns="">
            <child/>
            <p:child/>
            <scoped xmlns="urn:example:inner"/>
          </plain>
          <sibling/>
        </root>
      `);
      const plain = root.getElementsByTagName('plain')[0];
      const child = plain.getElementsByTagName('child')[0];

      expect(root.namespaceURI).toBe('urn:example:outer');
      expect(plain.namespaceURI).toBeNull();
      expect(child.namespaceURI).toBeNull();
      expect(plain.getElementsByTagName('p:child')[0].namespaceURI).toBe('urn:example:prefix');
      expect(plain.getElementsByTagName('scoped')[0].namespaceURI).toBe('urn:example:inner');
      expect(root.getElementsByTagName('sibling')[0].namespaceURI).toBe('urn:example:outer');
      expect(root.getElementsByTagNameNS('', '*')).toEqual([plain, child]);
      expect(Parser.parse(root.toXMLString()).getElementsByTagName('plain')[0].namespaceURI).toBeNull();
    });

    it('移除空 xmlns 后重新继承默认命名空间', () => {
      const root = XMPPElement.createElementNS('urn:example:outer', 'root');
      const child = XMPPElement.createElement('child', { xmlns: '' });
      root.appendChild(child);

      expect(child.namespaceURI).toBeNull();
      child.removeAttribute('xmlns');
      expect(child.namespaceURI).toBe('urn:example:outer');
      child.setAttribute('xmlns', '');
      expect(child.namespaceURI).toBeNull();
    });
  });

  describe('localName', () => {
    it('返回去掉前缀的名称', () => {
      const el = XMPPElement.createElement('message');
      expect(el.localName).toBe('message');
    });

    it('去掉命名空间前缀', () => {
      const el = XMPPElement.createElementNS('http://example.com', 'ns:message');
      expect(el.localName).toBe('message');
    });
  });

  describe('appendChild', () => {
    it('追加子元素', () => {
      const el = XMPPElement.createElement('message');
      const body = XMPPElement.createElement('body');
      const result = el.appendChild(body);
      
      expect(result).toBe(body);
      expect(body.parentNode).toBe(el);
      expect(el.childNodes[0]).toBe(body);
    });
  });

  describe('removeChild', () => {
    it('移除子元素', () => {
      const el = XMPPElement.createElement('message');
      const body = XMPPElement.createElement('body');
      el.appendChild(body);
      
      const result = el.removeChild(body);
      expect(result).toBe(body);
      expect(body.parentNode).toBeNull();
      expect(el.childNodes).toEqual([]);
    });
  });

  describe('getAttribute', () => {
    it('获取属性值', () => {
      const el = XMPPElement.createElement('message');
      el.setAttribute('id', '123');
      expect(el.getAttribute('id')).toBe('123');
    });

    it('属性缺失时返回 null', () => {
      const el = XMPPElement.createElement('message');
      expect(el.getAttribute('id')).toBeNull();
    });

    it('安全处理普通对象继承来的名称', () => {
      const el = XMPPElement.createElement('message');

      expect(el.getAttribute('constructor')).toBeNull();
      expect(el.getAttribute('toString')).toBeNull();
      expect(el.getAttribute('__proto__')).toBeNull();

      el.setAttribute('constructor', 'ctor');
      el.setAttribute('toString', 'stringifier');
      el.setAttribute('__proto__', 'prototype');

      expect(el.getAttribute('constructor')).toBe('ctor');
      expect(el.getAttribute('toString')).toBe('stringifier');
      expect(el.getAttribute('__proto__')).toBe('prototype');
    });
  });

  describe('setAttribute', () => {
    it('设置属性并返回 this', () => {
      const el = XMPPElement.createElement('message');
      const result = el.setAttribute('id', '123');
      
      expect(result).toBe(el);
      expect(el.getAttribute('id')).toBe('123');
    });
  });

  describe('removeAttribute', () => {
    it('移除属性', () => {
      const el = XMPPElement.createElement('message');
      el.setAttribute('id', '123');
      el.setAttribute('type', 'chat');
      
      const result = el.removeAttribute('id');
      expect(result).toBe(el);
      expect(el.getAttribute('id')).toBeNull();
      expect(el.getAttribute('type')).toBe('chat');
    });
  });

  describe('textContent', () => {
    it('返回子节点的文本内容', () => {
        const el = XMPPElement.createElement('message');
        el.append('Hello', ' ', 'World');
        expect(el.textContent).toBe('Hello World');
    });

    it('递归收集后代文本内容', () => {
        const el = XMPPElement.createElement('message');
        el.append('Hello');
        const b = XMPPElement.createElement('b');
        b.append('World');
        el.appendChild(b);
        expect(el.textContent).toBe('HelloWorld');
    });

    it.each(['', null])('设置为 %s 时清空子节点', (value) => {
      const el = XMPPElement.createElement('message');
      const child = XMPPElement.createElement('body');
      el.appendChild(child);

      el.textContent = value!;

      expect(el.childNodes).toHaveLength(0);
      expect(child.parentNode).toBeNull();
      expect(el.toXMLString()).toBe('<message/>');
    });
  });

  describe('toXMLString', () => {
      it('序列化简单元素', () => {
          const el = XMPPElement.createElement('message');
          expect(el.toXMLString()).toBe('<message/>');
      });

      it('序列化带属性的元素', () => {
          const el = XMPPElement.createElement('message');
          el.setAttribute('to', 'user@example.com');
          expect(el.toXMLString()).toBe('<message to="user@example.com"/>');
      });

      it('序列化带文本内容的元素', () => {
          const el = XMPPElement.createElement('message');
          el.append('Hello');
          expect(el.toXMLString()).toBe('<message>Hello</message>');
      });

      it('序列化嵌套元素', () => {
          const el = XMPPElement.createElement('message');
          const body = XMPPElement.createElement('body');
          body.append('Hello');
          el.appendChild(body);
          expect(el.toXMLString()).toBe('<message><body>Hello</body></message>');
      });
      
      it('按缩进序列化', () => {
        const el = XMPPElement.createElement('message');
        const body = XMPPElement.createElement('body');
        body.append('Hello');
        el.appendChild(body);
        
        const xml = el.toXMLString(2);
        // level 参数默认为 2，子节点缩进 = 2 * (level + 1) = 6 空格
        expect(xml).toBe('<message>\n      <body>Hello</body>\n    </message>');
      });
  });
  
  describe('appendChild reparent', () => {
    it('从旧父节点移动子节点', () => {
      const a = XMPPElement.createElement('a');
      const b = XMPPElement.createElement('b');
      const child = XMPPElement.createElement('child');
      a.appendChild(child);
      b.appendChild(child);
      expect(a.childNodes).toHaveLength(0);
      expect(b.childNodes[0]).toBe(child);
      expect(child.parentNode).toBe(b);
    });

    it('拒绝把元素插入自身', () => {
      const el = XMPPElement.createElement('message');

      expect(() => el.appendChild(el)).toThrowError(
        expect.objectContaining({ name: 'HierarchyRequestError' })
      );
      expect(el.parentNode).toBeNull();
      expect(el.childNodes).toHaveLength(0);
    });

    it('把祖先插入其后代不报错（不检测环）', () => {
      const root = XMPPElement.createElement('root');
      const child = XMPPElement.createElement('child');
      root.appendChild(child);

      expect(() => child.appendChild(root)).not.toThrow();
      expect(root.parentNode).toBe(child);
    });
  });

  describe('removeChild throw', () => {
    it('不是子节点时抛错', () => {
      const el = XMPPElement.createElement('message');
      const body = XMPPElement.createElement('body');
      expect(() => el.removeChild(body)).toThrow(
        'The node to be removed is not a child of this node.'
      );
      expect(() => el.removeChild(body)).toThrowError(
        expect.objectContaining({ name: 'NotFoundError' })
      );
    });
  });

  describe('getElementsByTagNameNS', () => {
    it('支持命名空间通配符与空字符串', () => {
      const root = XMPPElement.createElementNS('urn:x', 'x:root');
      const item = XMPPElement.createElementNS('urn:x', 'x:item');
      root.appendChild(item);
      const plain = XMPPElement.createElement('item');
      root.appendChild(plain);

      expect(root.getElementsByTagNameNS('*', 'item')).toHaveLength(2);
      expect(root.getElementsByTagNameNS('urn:x', '*')).toHaveLength(1);
      expect(root.getElementsByTagNameNS('', 'item')).toContain(plain);
    });
  });

  describe('querySelector', () => {
    const build = () => {
      const root = XMPPElement.createElement('root');
      const a = XMPPElement.createElement('a');
      const b = XMPPElement.createElement('b');
      b.setAttribute('id', 'target');
      b.setAttribute('class', 'x y');
      b.setAttribute('type', 'chat');
      const c = XMPPElement.createElement('c');
      root.appendChild(a);
      a.appendChild(b);
      b.appendChild(c);
      return { root, a, b, c };
    };

    it('按标签名返回第一个匹配的后代', () => {
      const { root, b } = build();
      expect(root.querySelector('b')).toBe(b);
    });

    it('空字符串抛 SyntaxError', () => {
      const { root } = build();
      expect(() => root.querySelector('')).toThrowError(
        expect.objectContaining({ name: 'SyntaxError' })
      );
    });

    it('运行时缺少参数时按字符串选择器处理', () => {
      const { root } = build();
      const target = XMPPElement.createElement('undefined');
      root.appendChild(target);
      expect(
        (root.querySelector as unknown as (selector?: string) => XMPPElement | null)()
      ).toBe(target);
    });

    it('不支持 * 通配时仍匹配任意元素', () => {
      const { root, a } = build();
      expect(root.querySelector('*')).toBe(a);
    });

    it('只匹配后代，不含自身', () => {
      const { root, a } = build();
      expect(a.querySelector('a')).toBeNull();
      root.appendChild(XMPPElement.createElement('a'));
      expect(a.querySelector('root')).toBeNull();
    });

    it('无匹配返回 null', () => {
      const { root } = build();
      expect(root.querySelector('zzz')).toBeNull();
    });

    it('支持 #id 与 .class', () => {
      const { root, b } = build();
      expect(root.querySelector('#target')).toBe(b);
      expect(root.querySelector('.x')).toBe(b);
      expect(root.querySelector('.z')).toBeNull();
    });

    it('支持属性选择器', () => {
      const { root, b } = build();
      expect(root.querySelector('[type]')).toBe(b);
      expect(root.querySelector('[type=chat]')).toBe(b);
      expect(root.querySelector('[class~="y"]')).toBe(b);
      expect(root.querySelector('[type=groupchat]')).toBeNull();
    });

    it('支持后代与子代组合符', () => {
      const { root, b, c } = build();
      expect(root.querySelector('a b')).toBe(b);
      expect(root.querySelector('a > b')).toBe(b);
      expect(root.querySelector('a > c')).toBeNull();
      expect(root.querySelector('b c')).toBe(c);
    });

    it('支持逗号分隔的选择器列表', () => {
      const { root, b } = build();
      expect(root.querySelector('zzz, b')).toBe(b);
    });

    it('支持 :scope 查询当前元素的直接子元素', () => {
      const { root, a, b } = build();
      expect(root.querySelector(':scope > a')).toBe(a);
      expect(root.querySelector(':scope > b')).toBeNull();
      expect(root.querySelectorAll(':scope > a')).toHaveLength(1);
      expect(root.matches(':scope')).toBe(true);
      expect(root.matches(':SCOPE')).toBe(true);
      expect(a.matches(':scope')).toBe(true);
      expect(b.matches(':scope')).toBe(true);
    });

    it('带 :scope 的后代组合仍从当前元素开始匹配', () => {
      const { root, b } = build();
      expect(root.querySelector(':scope a > b')).toBe(b);
      expect(root.querySelector(':scope > a b')).toBe(b);
    });

    it('带前缀名称用 | 或转义匹配 tagName，localName 直接可用', () => {
      const root = XMPPElement.createElement('root');
      const features = XMPPElement.createElement('stream:features');
      root.appendChild(features);
      expect(root.querySelector('stream|features')).toBe(features);
      expect(root.querySelector('stream\\:features')).toBe(features);
      expect(root.querySelector('stream|*')).toBe(features);
      expect(root.querySelector('*|features')).toBe(features);
      expect(root.querySelector('features')).toBe(features);
      // `:` 一律按伪类解析，未支持的伪类按非法选择器处理
      expect(() => root.querySelector('stream:features')).toThrowError(
        expect.objectContaining({ name: 'SyntaxError' })
      );
      expect(root.querySelector('stream|error')).toBeNull();
    });

    it('属性名/值支持前缀、转义、逗号与方括号', () => {
      const root = XMPPElement.createElement('root');
      const msg = XMPPElement.createElement('message');
      msg.setAttribute('xml:lang', 'en');
      msg.setAttribute('body', 'a,b]c');
      const item = XMPPElement.createElement('item');
      msg.appendChild(item);
      root.appendChild(msg);
      expect(root.querySelector('[xml:lang="en"]')).toBe(msg);
      expect(root.querySelector('[xml|lang]')).toBe(msg);
      expect(root.querySelector('[body="a,b]c"]')).toBe(msg);
      expect(root.querySelector('[body="a,b]c"] item')).toBe(item);
      msg.setAttribute('quoted', 'a"b');
      expect(root.querySelector('[quoted="a\\"b"]')).toBe(msg);
      msg.setAttribute('escaped', 'b]c');
      expect(root.querySelector('[escaped=b\\]c]')).toBe(msg);
      msg.setAttribute('space', 'b c');
      expect(root.querySelector('[space=b\\ c]')).toBe(msg);
      msg.setAttribute('trailing', 'b ');
      expect(root.querySelector('[trailing=b\\ ]')).toBe(msg);
    });

    it('转义分隔符不会被外层扫描器切断', () => {
      const root = XMPPElement.createElement('root');
      const el = XMPPElement.createElement('item');
      el.setAttribute('class', 'a,b');
      root.appendChild(el);
      expect(root.querySelector('.a\\,b')).toBe(el);
    });

    it('支持 + 与 ~ 兄弟组合符', () => {
      const root = XMPPElement.createElement('root');
      const a = XMPPElement.createElement('a');
      const b = XMPPElement.createElement('b');
      const c = XMPPElement.createElement('c');
      root.appendChild(a);
      root.appendChild(b);
      root.appendChild(c);
      expect(root.querySelector('a + b')).toBe(b);
      expect(root.querySelector('a ~ c')).toBe(c);
      expect(root.querySelector('a + c')).toBeNull();
    });

    it('标签名支持 \\ 转义', () => {
      const root = XMPPElement.createElement('root');
      const el = XMPPElement.createElement('a:b');
      root.appendChild(el);
      expect(root.querySelector('a\\:b')).toBe(el);
    });

    it('未知伪类与伪元素抛 SyntaxError', () => {
      const { root } = build();
      const unsupported = ['b:first-child', 'b:not(.z)', 'b:unknown', 'b::text'];
      for (const selector of unsupported) {
        expect(() => root.querySelector(selector)).toThrowError(
          expect.objectContaining({ name: 'SyntaxError' })
        );
      }
    });

    it('非法选择器抛 SyntaxError', () => {
      const { root } = build();
      const invalid = [
        ', b',
        'a,',
        'a >',
        '> a',
        'a >, b',
        'a > + b',
        '*foo',
        'a*',
        'a|b|c',
        'a|b*',
        '[a',
        'a]',
        '#',
        '[a=]',
        'a:not(',
      ];
      for (const selector of invalid) {
        expect(() => root.querySelector(selector)).toThrowError(
          expect.objectContaining({ name: 'SyntaxError' })
        );
      }
    });

    it('深层树查询不依赖递归调用栈', () => {
      const root = XMPPElement.createElement('root');
      let current = root;
      for (let i = 0; i < 5000; i++) {
        const child = XMPPElement.createElement(i === 4999 ? 'leaf' : 'node');
        current.appendChild(child);
        current = child;
      }
      expect(root.querySelector('leaf')).toBe(current);
      expect(root.querySelectorAll('leaf').item(0)).toBe(current);
    });

    it('解析结果缓存不影响重复查询', () => {
      const { root, b } = build();
      expect(root.querySelector('.x')).toBe(b);
      expect(root.querySelector('.x')).toBe(b);
      expect(root.querySelectorAll('.x')).toHaveLength(1);
    });
  });

  describe('querySelectorAll', () => {
    it('按前序返回全部匹配元素', () => {
      const root = XMPPElement.createElement('root');
      const item1 = XMPPElement.createElement('item');
      const item2 = XMPPElement.createElement('item');
      root.appendChild(item1);
      root.appendChild(item2);
      const result = root.querySelectorAll('item');
      expect(result).toHaveLength(2);
      expect(result.item(0)).toBe(item1);
      expect(result.item(1)).toBe(item2);
    });

    it('无匹配返回空集合', () => {
      const root = XMPPElement.createElement('root');
      expect(root.querySelectorAll('item')).toHaveLength(0);
    });

    it('空字符串抛 SyntaxError', () => {
      const root = XMPPElement.createElement('root');
      expect(() => root.querySelectorAll('')).toThrowError(
        expect.objectContaining({ name: 'SyntaxError' })
      );
    });

    it('逗号分组与带引号值互不干扰', () => {
      const root = XMPPElement.createElement('root');
      const m = XMPPElement.createElement('m');
      m.setAttribute('body', 'a,b');
      const item = XMPPElement.createElement('item');
      root.appendChild(m);
      root.appendChild(item);
      expect(root.querySelectorAll('[body="a,b"], item')).toHaveLength(2);
    });
  });

  describe('matches', () => {
    const build = () => {
      const root = XMPPElement.createElement('root');
      const a = XMPPElement.createElement('a');
      const b = XMPPElement.createElement('b');
      root.appendChild(a);
      a.appendChild(b);
      return { root, a, b };
    };

    it('自身匹配返回 true', () => {
      const { b } = build();
      expect(b.matches('b')).toBe(true);
    });

    it('不匹配返回 false', () => {
      const { b } = build();
      expect(b.matches('c')).toBe(false);
    });

    it('组合符沿祖先链判断', () => {
      const { a, b } = build();
      expect(b.matches('a b')).toBe(true);
      expect(b.matches('a > b')).toBe(true);
      expect(a.matches('a > b')).toBe(false);
    });

    it('兄弟组合符沿兄弟链判断', () => {
      const root = XMPPElement.createElement('root');
      const a = XMPPElement.createElement('a');
      const b = XMPPElement.createElement('b');
      root.appendChild(a);
      root.appendChild(b);
      expect(b.matches('a + b')).toBe(true);
      expect(b.matches('a ~ b')).toBe(true);
      expect(a.matches('a + b')).toBe(false);
    });

    it('空字符串抛 SyntaxError', () => {
      const { b } = build();
      expect(() => b.matches('')).toThrowError(
        expect.objectContaining({ name: 'SyntaxError' })
      );
    });
  });

  describe('append', () => {
    it('追加多个节点', () => {
      const el = XMPPElement.createElement('message');
      const child1 = XMPPElement.createElement('child1');
      const child2 = XMPPElement.createElement('child2');
      
      el.append(child1, 'text', child2);
      
      expect(el.childNodes).toHaveLength(3);
      expect(el.childNodes[0]).toBe(child1);
      expect(el.childNodes[1]).toBe('text');
      expect(el.childNodes[2]).toBe(child2);
      
      expect(child1.parentNode).toBe(el);
      expect(child2.parentNode).toBe(el);
    });
  });

  describe('parentElement', () => {
    it('返回父元素', () => {
      const el = XMPPElement.createElement('message');
      const child = XMPPElement.createElement('child');
      el.appendChild(child);
      expect(child.parentElement).toBe(el);
    });
    
    it('无父节点时返回 null', () => {
      const el = XMPPElement.createElement('message');
      expect(el.parentElement).toBeNull();
    });

    it('以只读 getter 暴露 parentNode', () => {
      const descriptor = Object.getOwnPropertyDescriptor(
        XMPPElement.prototype,
        'parentNode'
      );

      const get = descriptor?.get?.bind(descriptor);
      const set = descriptor?.set?.bind(descriptor);
      expect(get).toBeTypeOf('function');
      expect(set).toBeUndefined();
    });
  });

  describe('write', () => {
    it('写入到函数', () => {
      const el = XMPPElement.createElement('message');
      el.setAttribute('to', 'user');
      el.append('Hello');
      
      let output = '';
      el.write((chunk) => { output += chunk; });
      
      expect(output).toBe('<message to="user">Hello</message>');
    });
  });

  describe('类型强制', () => {
    it('setAttribute 将值转为字符串', () => {
      const el = XMPPElement.createElement('message');
      el.setAttribute('id', 123 as unknown as string);
      expect(el.getAttribute('id')).toBe('123');
    });

    it('textContent setter 将值转为字符串', () => {
      const el = XMPPElement.createElement('message');
      el.textContent = 42 as unknown as string;
      expect(el.textContent).toBe('42');
    });
  });

  describe('insertBefore', () => {
    it('在参考节点前插入', () => {
      const el = XMPPElement.createElement('root');
      const ref = XMPPElement.createElement('ref');
      const inserted = XMPPElement.createElement('inserted');
      el.appendChild(ref);
      el.insertBefore(inserted, ref);
      expect(el.childNodes[0]).toBe(inserted);
      expect(el.childNodes[1]).toBe(ref);
    });

    it('参考节点不是子节点时抛 NotFoundError', () => {
      const el = XMPPElement.createElement('root');
      const ref = XMPPElement.createElement('ref');
      expect(() => el.insertBefore(XMPPElement.createElement('x'), ref)).toThrowError(
        expect.objectContaining({ name: 'NotFoundError' })
      );
    });
  });
});
