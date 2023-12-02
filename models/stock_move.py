
from odoo import _, api, fields, models


class StockMoveLine(models.Model):
    _inherit = "stock.move.line"

    for_default_product = fields.Boolean(compute='_compute_for_default_product', default=False,
                                         help='stock move for default product?')
    
    @api.depends('product_id')
    def _compute_for_default_product(self):
        if self.picking_type_id.default_product_id==self.product_id:
            self.for_default_product = True
        else:
            self.for_default_product = False