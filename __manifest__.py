# -*- coding: utf-8 -*-
{
    'name': "Default Serials",

    'summary': """
        Select a default product and assign serial number when scanning nonexistent serial numbers
    """,
    'description': """
    
    Custom modifications to the barcode app
    ===========================

    1. Assigns a non-existent serial(that has an "LPN" prefix) to a default 
        product on a picking if the default product is setup.
    2. Sets maximum number of picking lines that can be done per picking.
    3. Validates, opens a new picking and sets the last scanned product in the new
        picking when a new product is scanned after the maximum lines is reached.
    4. Changes error message of missing barcode to an alert popup the user has 
        to click to close.
    5. Uses a predefined location as destination location when the default product
        is used due to point 1.
    6. Uses the "inventory location" or adjustment location of the default product as 
        the counterpart(source) location when it is used as a result of point 1. This is 
        so it does not have negative quant in the source location
    7. Removes Grouping caused by lot/serials in the barcode app
    8. Lets the user scan package before scanning each product.

    """,


    'author': "Tony Atsevah",
    'website': "https://dbsoftint.com",
    'maintainer': 'tonyatsevah@gmail.com',

    'category': 'Uncategorized',
    'version': '0.1',

    'depends': ['stock_barcode'],

    'data': [
        'views/stock_picking_view.xml',
        'views/stock_move_line_view.xml',
    ],
    'assets': {
        'web.assets_backend': [
            'prc_stock_lot_default_product/static/src/js/barcode_picking_model.js',
            'prc_stock_lot_default_product/static/src/js/main.js',
        ],
    },
}
