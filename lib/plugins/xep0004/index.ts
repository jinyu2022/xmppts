import { Form } from './form'
import type { Plugin } from '../types';
import type { Connection } from '../../connection';

/**
 * XEP-0004: Data Forms
 * @see https://xmpp.org/extensions/xep-0004.html
 * @version 2.13.2 (2024-08-30)
 */
export class XEP0004 extends Form implements Plugin {
    static readonly dependencies = [] as const
    constructor(_connection: Connection) {
        super();
    }

    init() { 
        return
    }
}

export default XEP0004