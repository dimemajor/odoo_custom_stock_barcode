/** @odoo-module **/

import MainComponent from '@stock_barcode/components/main';
import { patch } from 'web.utils';
import { useService } from "@web/core/utils/hooks";


patch(MainComponent.prototype, 'stock_barcode_last_scanned', {
    // pass actionService to barcode_picking_model
    _getModel(params) {
        params.actionService = useService('action');
        return this._super(...arguments);
    }
})