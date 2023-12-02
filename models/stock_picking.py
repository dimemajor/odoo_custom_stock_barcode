from odoo import models, fields, api
from odoo.tools import OrderedSet


class PickingType(models.Model):
    _inherit = 'stock.picking.type'
    default_product_id = fields.Many2one('product.product', 
                                         string='Missing Serial Product',
                                         domain=[('detailed_type', '=', 'product'), ('tracking', '=', 'serial'), ('barcode', '!=', False)],
                                         help='This product will be used if serial number is not found when scanning. \
                                            Only storable products that have a barcode and are tracked by serial numbers are allowed ')
    default_location_id = fields.Many2one('stock.location',
                                         string='Missing Product Destination Location', 
                                         help='Destinantion location used when default product is scanned. Used in Barcode app only', default=False)
    default_product_barcode = fields.Char(related='default_product_id.barcode')
    max_lines = fields.Integer(string='Maximum lines', help='Maximum number of lines allowed per operation/transfer')
    restrict_put_in_pack = fields.Selection(
        [
            ('mandatory', "After each product"),
            ('optional', "After group of Products"),
            ('no', "No"),
            ('before_each_product', 'Before Each Product')
        ], "Force put in pack?",
        help="Does the picker have to put in a package the scanned products? If yes, at which rate?",
        default="optional", required=True)
    automatic_src = fields.Boolean(String='Automatically Select Source Location from First Scan')
    

    def _get_barcode_config(self):
        # adding fields needed in barcode app
        config = super()._get_barcode_config()
        config.update({
            'default_product_barcode': self.default_product_barcode,
            'default_location_id': self.default_location_id.id,
            'default_product_id': self.default_product_id.id,
            'max_lines': self.max_lines if self.max_lines>0 else 0,
            'picking_type_id': self.id,
        })
        return config


class PickingType(models.Model):
    _inherit = 'stock.picking'


    def _sanity_check(self):
        # if the default serial is used, the source location will be adjustment location
        # so the real source dosent have negative quantities
        for picking in self:
            for ml in picking.move_line_ids:
                if ml.product_id.id==picking.picking_type_id.default_product_id.id:
                    ml.location_id = ml.product_id.property_stock_inventory
        super()._sanity_check()
        # assign stock.lot here for the default product here regardless of the configuration
        ml_ids_to_create_lot = OrderedSet()
        for picking in self:
            for ml in picking.move_line_ids:
                if ml.lot_name and not ml.lot_id and ml.product_id.id==picking.picking_type_id.default_product_id.id:
                    ml_ids_to_create_lot.add(ml.id)
                    ml.picking_id = False
        ml_to_create_lot = self.env['stock.move.line'].browse(ml_ids_to_create_lot)
        ml_to_create_lot.with_context(bypass_reservation_update=True)._create_and_assign_production_lot()


    def barcode_validate(self):
        # context causing validation issues
        self.with_context(skip_immediate=True).button_validate()  

    def _get_stock_barcode_data(self):
        data = super()._get_stock_barcode_data()
        default_locations = self.env['stock.location'].search([('id', 'child_of', self.picking_type_id.default_location_id.ids)])
        data['records']['stock.location'].extend(
            default_locations.read(default_locations._get_fields_stock_barcode(), load=False),
        )
        return data


