/** @odoo-module **/

import BarcodePickingModel from '@stock_barcode/models/barcode_picking_model';
import { patch } from 'web.utils';
import {_t, _lt} from "web.core";
import { AlertDialog } from "@web/core/confirmation_dialog/confirmation_dialog";
import { sprintf } from '@web/core/utils/strings';


/**
 * 
 * Do a search for "modified section" to find all new code in overwritten methods
 * 
 * 
 * 
 */
patch(BarcodePickingModel.prototype, 'stock_barcode_default_product', {

    setData(data) {
        this._super(...arguments);
        this.validateMethod = 'barcode_validate';
        if (this.params.action.context.last_scanned_barcode) {
            this._processBarcode(this.params.action.context.last_scanned_barcode);
        }
    },

    async _processBarcode(barcode) {
        // modified section
        const defaultBarcode = this.config.default_product_barcode;
        this.scanned_barcode = barcode;
        // end of modified section
        
        let barcodeData = {};
        let currentLine = false;
        // Creates a filter if needed, which can help to get the right record
        // when multiple records have the same model and barcode.
        const filters = {};
        if (this.selectedLine && this.selectedLine.product_id.tracking !== 'none') {
            filters['stock.lot'] = {
                product_id: this.selectedLine.product_id.id,
            };
        }
        try {
            barcodeData = await this._parseBarcode(barcode, filters);
            if (!barcodeData.match && filters['stock.lot'] &&
            !this.canCreateNewLot && this.useExistingLots) {
                // Retry to parse the barcode without filters in case it matches an existing
                // record that can't be found because of the filters
                const lot = await this.cache.getRecordByBarcode(barcode, 'stock.lot');
                if (lot) {
                    Object.assign(barcodeData, { lot, match: true });
                }
            }
        } catch (parseErrorMessage) {
            barcodeData.error = parseErrorMessage;
        }

        // Process each data in order, starting with non-ambiguous data type.
        if (barcodeData.action) { // As action is always a single data, call it and do nothing else.
            return await barcodeData.action();
        }

        // Depending of the configuration, the user can be forced to scan a specific barcode type.
        const check = this._checkBarcode(barcodeData);
        if (check.error) {
            return this.notification.add(check.message, { title: check.title, type: "danger" });
        }

        if (barcodeData.packaging) {
            barcodeData.product = this.cache.getRecord('product.product', barcodeData.packaging.product_id);
            barcodeData.quantity = ("quantity" in barcodeData ? barcodeData.quantity : 1) * barcodeData.packaging.qty;
            barcodeData.uom = this.cache.getRecord('uom.uom', barcodeData.product.uom_id);
        }

        if (barcodeData.product) { // Remembers the product if a (packaging) product was scanned.
            this.lastScanned.product = barcodeData.product;
        }
        if (barcodeData.lot && !barcodeData.product) {
            barcodeData.product = this.cache.getRecord('product.product', barcodeData.lot.product_id);
        }
        
        await this._processLocation(barcodeData);
        await this._processPackage(barcodeData);
        if (barcodeData.stopped) {
            // TODO: Sometime we want to stop here instead of keeping doing thing,
            // but it's a little hacky, it could be better to don't have to do that.
            return;
        }

        if (barcodeData.weight) { // Convert the weight into quantity.
            barcodeData.quantity = barcodeData.weight.value;
        }

        // If no product found, take the one from last scanned line if possible.
        if (!barcodeData.product) {
            if (barcodeData.quantity) {
                currentLine = this.selectedLine || this.lastScannedLine;
            } else if (this.selectedLine && this.selectedLine.product_id.tracking !== 'none') {
                currentLine = this.selectedLine;
            } else if (this.lastScannedLine && this.lastScannedLine.product_id.tracking !== 'none') {
                currentLine = this.lastScannedLine;
            }
            if (currentLine) { // If we can, get the product from the previous line.
                const previousProduct = currentLine.product_id;
                // If the current product is tracked and the barcode doesn't fit
                // anything else, we assume it's a new lot/serial number.
                if (previousProduct.tracking !== 'none' &&
                    !barcodeData.match && this.canCreateNewLot) {
                    barcodeData.lotName = barcode;
                    barcodeData.product = previousProduct;
                }
                
                // modified section

                // The default product on the operation type can always create new 
                // serial numbers
                if (defaultBarcode  &&
                    previousProduct.barcode==defaultBarcode &&
                    previousProduct.tracking === 'serial' &&
                    !barcodeData.match) {
                    barcodeData.lotName = barcode;
                    barcodeData.product = previousProduct;
                }

                // end of modified section

                if (barcodeData.lot || barcodeData.lotName ||
                    barcodeData.quantity) {
                    barcodeData.product = previousProduct;
                }
            }
        }
        const {product} = barcodeData;

        if (!product) { // Product is mandatory, if no product, raises a warning.
            if (!barcodeData.error) {

                // modified section

                if ( defaultBarcode &&  // Only attempt when a default code is set
                    barcode !== defaultBarcode && // To prevent recursive calls to '_processBarcode'
                    !barcodeData.match &&// If the barcode to be scanned matches something other than a product, it shouldnt be used as a serial
                    this.useExistingLots &&
                    barcode.toString().toLowerCase().startsWith('lpn') // as requested. Probably not best to hardcode this
                )  {
                    // There are two _processBarcode function to run in this block. So we want to prevent
                    // the case where after one is ran, a new picking is created thereby interrupting the process.
                    if (this._checkValidate()){ 
                        this.validateAndCreateNewPicking();
                        return;
                    }
                    this.notification.add(
                        _t(`Product not found. The default product on the operation type will be added instead`),
                        { type: 'warning' }
                        );
                    await this._processBarcode(defaultBarcode) // add default product instead
                    await this._processBarcode(barcode) // should set serial on the default product
                    return;
                    // serial_number is not found, default product will be used and the barcode set as the serial number.
                } else if (this.groups.group_tracking_lot) {
                    this.dialogService.add(AlertDialog, {
                        title: _t("Product not found"),
                        body: _t("You are expected to scan one or more products or a package available at the picking location"),
                    });
                    return;
                } else {
                    barcodeData.error = _t("You are expected to scan one or more products.");
                }

                // end of modified section
            }
            
            return this.notification.add(barcodeData.error, { type: 'danger' });
        } else if (barcodeData.lot && barcodeData.lot.product_id !== product.id) {
            delete barcodeData.lot; // The product was scanned alongside another product's lot.
        }
        if (barcodeData.weight) { // the encoded weight is based on the product's UoM
            barcodeData.uom = this.cache.getRecord('uom.uom', product.uom_id);
        }

        // Searches and selects a line if needed.
        if (!currentLine || this._shouldSearchForAnotherLine(currentLine, barcodeData)) {
            currentLine = this._findLine(barcodeData);
        }

        // Default quantity set to 1 by default if the product is untracked or
        // if there is a scanned tracking number.
        if (product.tracking === 'none' || barcodeData.lot || barcodeData.lotName || this._incrementTrackedLine()) {
            const hasUnassignedQty = currentLine && currentLine.qty_done && !currentLine.lot_id && !currentLine.lot_name;
            const isTrackingNumber = barcodeData.lot || barcodeData.lotName;
            const defaultQuantity = isTrackingNumber && hasUnassignedQty ? 0 : 1;
            barcodeData.quantity = barcodeData.quantity || defaultQuantity;
            if (product.tracking === 'serial' && barcodeData.quantity > 1 && (barcodeData.lot || barcodeData.lotName)) {
                barcodeData.quantity = 1;
                this.notification.add(
                    _t(`A product tracked by serial numbers can't have multiple quantities for the same serial number.`),
                    { type: 'danger' }
                );
            }
        }

        if ((barcodeData.lotName || barcodeData.lot) && product) {
            const lotName = barcodeData.lotName || barcodeData.lot.name;
            for (const line of this.currentState.lines) {
                if (line.product_id.tracking === 'serial' && this.getQtyDone(line) !== 0 &&
                    ((line.lot_id && line.lot_id.name) || line.lot_name) === lotName) {
                    return this.notification.add(
                        _t("The scanned serial number is already used."),
                        { type: 'danger' }
                    );
                }
            }
            // Prefills `owner_id` and `package_id` if possible.
            const prefilledOwner = (!currentLine || (currentLine && !currentLine.owner_id)) && this.groups.group_tracking_owner && !barcodeData.owner;
            const prefilledPackage = (!currentLine || (currentLine && !currentLine.package_id)) && this.groups.group_tracking_lot && !barcodeData.package;
            if (this.useExistingLots && (prefilledOwner || prefilledPackage)) {
                const lotId = (barcodeData.lot && barcodeData.lot.id) || (currentLine && currentLine.lot_id && currentLine.lot_id.id) || false;
                const res = await this.orm.call(
                    'product.product',
                    'prefilled_owner_package_stock_barcode',
                    [product.id],
                    {
                        lot_id: lotId,
                        lot_name: (!lotId && barcodeData.lotName) || false,
                    }
                );
                this.cache.setCache(res.records);
                if (prefilledPackage && res.quant && res.quant.package_id) {
                    barcodeData.package = this.cache.getRecord('stock.quant.package', res.quant.package_id);
                }
                if (prefilledOwner && res.quant && res.quant.owner_id) {
                    barcodeData.owner = this.cache.getRecord('res.partner', res.quant.owner_id);
                }
            }
        }

        // Updates or creates a line based on barcode data.
        if (currentLine) { // If line found, can it be incremented ?
            let exceedingQuantity = 0;
            if (product.tracking !== 'serial' && barcodeData.uom && barcodeData.uom.category_id == currentLine.product_uom_id.category_id) {
                // convert to current line's uom
                barcodeData.quantity = (barcodeData.quantity / barcodeData.uom.factor) * currentLine.product_uom_id.factor;
                barcodeData.uom = currentLine.product_uom_id;
            }
            // Checks the quantity doesn't exceed the line's remaining quantity.
            if (currentLine.reserved_uom_qty && product.tracking === 'none') {
                const remainingQty = currentLine.reserved_uom_qty - currentLine.qty_done;
                if (barcodeData.quantity > remainingQty) {
                    // In this case, lowers the increment quantity and keeps
                    // the excess quantity to create a new line.
                    exceedingQuantity = barcodeData.quantity - remainingQty;
                    barcodeData.quantity = remainingQty;
                }
            }
            if (barcodeData.quantity > 0 || barcodeData.lot || barcodeData.lotName) {
                const fieldsParams = this._convertDataToFieldsParams(barcodeData);
                if (barcodeData.uom) {
                    fieldsParams.uom = barcodeData.uom;
                }
                await this.updateLine(currentLine, fieldsParams);
            }
            if (exceedingQuantity) { // Creates a new line for the excess quantity.
                barcodeData.quantity = exceedingQuantity;
                const fieldsParams = this._convertDataToFieldsParams(barcodeData);
                if (barcodeData.uom) {
                    fieldsParams.uom = barcodeData.uom;
                }
                currentLine = await this._createNewLine({
                    copyOf: currentLine,
                    fieldsParams,
                });
            }
        } else { // No line found, so creates a new one.
            const fieldsParams = this._convertDataToFieldsParams(barcodeData);
            if (barcodeData.uom) {
                fieldsParams.uom = barcodeData.uom;
            }
            currentLine = await this.createNewLine({fieldsParams});
        }

        // And finally, if the scanned barcode modified a line, selects this line.
        if (currentLine) {
            this._selectLine(currentLine);
        }
        this.trigger('update');
    },

    async _processPackage(barcodeData) {
        const { packageName } = barcodeData;
        const recPackage = barcodeData.package;
        this.lastScanned.packageId = false;
        if (barcodeData.packageType && !recPackage) {
            // Scanned a package type and no existing package: make a put in pack (forced package type).
            barcodeData.stopped = true;
            return await this._processPackageType(barcodeData);
        } else if (packageName && !recPackage) {
            // Scanned a non-existing package: make a put in pack.
            barcodeData.stopped = true;
            return await this._putInPack({ default_name: packageName });
        } else if (!recPackage || (
            recPackage.location_id && ![this._defaultDestLocation().id, this.location.id].includes(recPackage.location_id)
        )) {
            return; // No package, package's type or package's name => Nothing to do.
        }
        // If move entire package, checks if the scanned package matches a package line.
        if (this._moveEntirePackage()) {
            for (const packageLine of this.packageLines) {
                if (packageLine.package_id.name !== (packageName || recPackage.name)) {
                    continue;
                }
                barcodeData.stopped = true;
                if (packageLine.qty_done) {
                    this.lastScanned.packageId = packageLine.package_id.id;
                    const message = _t("This package is already scanned.");
                    this.notification.add(message, { type: 'danger' });
                    return this.trigger('update');
                }
                for (const line of packageLine.lines) {
                    this.selectedLineVirtualId = line.virtual_id;
                    await this._updateLineQty(line, { qty_done: line.reserved_uom_qty });
                    this._markLineAsDirty(line);
                }
                return this.trigger('update');
            }
        }
        // Scanned a package: fetches package's quant and creates a line for
        // each of them, except if the package is already scanned.
        // TODO: can check if quants already in cache to avoid to make a RPC if
        // there is all in it (or make the RPC only on missing quants).
        const res = await this.orm.call(
            'stock.quant',
            'get_stock_barcode_data_records',
            [recPackage.quant_ids]
        );
        this.cache.setCache(res.records);
        const quants = res.records['stock.quant'];
        const currentLine = this.selectedLine || this.lastScannedLine;

        // ****Modified Section******
        
        // if a new picking with no lines or the package for the last line is done,
        // save the package and use when creating a new line.
        //
        // Since the product has not been scanned yet, and the desination is not necessarily
        // the default on the operation type, we cant be sure if the package is available 
        // at the destination location or not.we'll have to leave that to validate method.
        if ((!currentLine || currentLine.result_package_id) &&
        this.config.restrict_put_in_pack === 'before_each_product' &&
        recPackage.location_id !== this._defaultLocation().id // if the location is the same, its most likely a case of _moveEntirePackage
        ) {
            this.lastScannedPackage = recPackage;
            // this.lastScanned.packageId = recPackage.id;
            barcodeData.stopped = true;
            this.trigger('update')
            return;
        }

        // ****End of Modified Section****

        // If the package is empty or is already at the destination location,
        // assign it to the last scanned line.
        if (currentLine && (!quants.length || (
            !currentLine.result_package_id && recPackage.location_id === currentLine.location_dest_id.id))) {
            await this._assignEmptyPackage(currentLine, recPackage);
            barcodeData.stopped = true;
            this.lastScanned.packageId = recPackage.id;
            this.trigger('update');
            return;
        }

        if (this.location && this.location.id !== recPackage.location_id) {
            // Package not at the source location: can't add its content.
            return;
        }

        // Checks if the package is already scanned.
        let alreadyExisting = 0;
        for (const line of this.pageLines) {
            if (line.package_id && line.package_id.id === recPackage.id &&
                this.getQtyDone(line) > 0) {
                alreadyExisting++;
            }
        }
        if (alreadyExisting >= quants.length) {
            barcodeData.error = _t("This package is already scanned.");
            return;
        }
        // For each quants, creates or increments a barcode line.
        for (const quant of quants) {
            const product = this.cache.getRecord('product.product', quant.product_id);
            const searchLineParams = Object.assign({}, barcodeData, { product });
            let remaining_qty = quant.quantity;
            let qty_used = 0;
            while (remaining_qty > 0) {
                const currentLine = this._findLine(searchLineParams);
                if (currentLine) { // Updates an existing line.
                    const qty_needed = Math.max(currentLine.reserved_uom_qty - currentLine.qty_done, 0);
                    qty_used = qty_needed ? Math.min(qty_needed, remaining_qty) : remaining_qty;
                    const fieldsParams = this._convertDataToFieldsParams({
                        quantity: qty_used,
                        lotName: barcodeData.lotName,
                        lot: barcodeData.lot,
                        package: recPackage,
                        owner: barcodeData.owner,
                    });
                    await this.updateLine(currentLine, fieldsParams);
                } else { // Creates a new line.
                    qty_used = remaining_qty;
                    const fieldsParams = this._convertDataToFieldsParams({
                        product,
                        quantity: qty_used,
                        lot: quant.lot_id,
                        package: quant.package_id,
                        resultPackage: quant.package_id,
                        owner: quant.owner_id,
                    });
                    await this._createNewLine({ fieldsParams });
                }
                remaining_qty -= qty_used;
            }
        }
        barcodeData.stopped = true;
        this.selectedLineVirtualId = false;
        this.lastScanned.packageId = recPackage.id;
        this.trigger('update');
    },

    _convertDataToFieldsParams(args) {
        var params = this._super(...arguments);
        if (params.location_dest_id) {
            if (args.product.barcode == this.config.default_product_barcode) {
                params.location_dest_id = this.config.default_location_id
            }
        }
        return params;
    },

    get barcodeInfo() {
        var result = this._super(...arguments);
        const line = this._getParentLine(this.selectedLine) || this.selectedLine;
        if (result.class !== 'scan_src' && // scan_src takes precedence
        this.config.restrict_put_in_pack === 'before_each_product' && 
        !this.lastScannedPackage) {
            return {
                message: _lt("Scan a package"),
                class: 'scan_package',
                icon: 'archive',
            };
        }
        return result
    },

    _checkBarcode(barcodeData) {
        const check = { title: _lt("Not the expected scan") };
        const { location, lot, product, destLocation, packageType } = barcodeData;
        const resultPackage = barcodeData.package;
        const packageWithQuant = (barcodeData.package && barcodeData.package.quant_ids || []).length;
        const line = this._getParentLine(this.selectedLine) || this.selectedLine;

        if (this.config.restrict_scan_source_location && !barcodeData.location) {
            // Special case where the user can not scan a destination but a source was already scanned.
            // That means what is supposed to be a destination is in this case a source.
            if (this.lastScanned.sourceLocation && barcodeData.destLocation &&
                this.config.restrict_scan_dest_location == 'no') {
                barcodeData.location = barcodeData.destLocation;
                delete barcodeData.destLocation;
            }
            // Special case where the source is mandatory and the app's waiting for but none was
            // scanned, get the previous scanned one if possible.
            if (!this.lastScanned.sourceLocation && this._currentLocation) {
                this.lastScanned.sourceLocation = this._currentLocation;
            }
        }

        if (this.config.restrict_scan_source_location && !this._currentLocation && !this.selectedLine) { // Source Location.
            if (location) {
                this.location = location;
            } else {
                check.title = _t("Mandatory Source Location");
                check.message = sprintf(
                    _t("You are supposed to scan %s or another source location"),
                    this.location.display_name,
                );
            }
        } else if (this.config.restrict_scan_product && // Restriction on product.
        !(product || packageWithQuant || this.selectedLine) && // A product/package was scanned.
        !(this.config.restrict_scan_source_location && location && !this.selectedLine) // Maybe the user scanned the wrong location and trying to scan the right one
        ) {
            check.message = lot ?
            _t("Scan a product before scanning a tracking number") :
            _t("You must scan a product");

        // ****** Modified Section ******

        } else if (this.config.restrict_put_in_pack == 'before_each_product' && 
            !this.lastScannedPackage && 
            (!line || (product && this.selectedLine && this.selectedLine.product_id.id != product.id) || location || destLocation) && 
            !(resultPackage || packageType)) {
                check.message = _t("You must scan a package")

        // ****** End of Modified Section ******

        } else if (this.config.restrict_put_in_pack == 'mandatory' && !(resultPackage || packageType) &&
                   this.selectedLine && !this.qty_done && !this.selectedLine.result_package_id &&
                   ((product && product.id != this.selectedLine.product_id.id) || location || destLocation)) { // Package.
            check.message = _t("You must scan a package or put in pack");
        } else if (this.config.restrict_scan_dest_location == 'mandatory' && !this.lastScanned.destLocation) { // Destination Location.
            if (destLocation) {
                this.lastScanned.destLocation = destLocation;
            } else if (product && this.selectedLine && this.selectedLine.product_id.id != product.id) {
                // Cannot scan another product before a destination was scanned.
                check.title = _t("Mandatory Destination Location");
                check.message = sprintf(
                    _t("Please scan destination location for %s before scanning other product"),
                    this.selectedLine.product_id.display_name
                );
            }
        }
        check.error = Boolean(check.message);
        return check;
    },

    async _createNewLine(params) {
        if (this._checkValidate()) {
            await this.validateAndCreateNewPicking();
            return;
        }
        const line = await this._super(...arguments);
        if (this.lastScannedPackage) {
            await this._assignEmptyPackage(line, this.lastScannedPackage)
            this.lastScanned.packageId = this.lastScannedPackage.id
            this.lastScannedPackage = false;
        }
        return line
    },

    _checkValidate() {
        if (this.config.max_lines) {
            if (this.config.max_lines !== 0 && this.currentState.lines.length >= this.config.max_lines) {
                return true;
            }
        }
        return false;
    },

    async validateAndCreateNewPicking() {
        await this.save();
        await this.orm.call(
            this.params.model,
            this.validateMethod,
            [this.recordIds],
            { context: { display_detailed_backorder: true } },
        );
        return this._afterValidate();
    },

    async _afterValidate() {
        this.notification.add(this.validateMessage, { type: 'success' });
        if (this.currentState.lines.length >= this.config.max_lines) {
            const context = {
                active_id: this.config.picking_type_id,
                active_model: 'stock.picking.type',
            }
            const action = await this.orm.call(
                'stock.picking',
                'action_open_new_picking',
                [], {context: context}
            );
            if (action) {
                this.params.actionService.doAction(action, {
                    additionalContext: {last_scanned_barcode: this.scanned_barcode}
                })
                return;
            }
        }
    },

    // remove grouping
    get groupedLines() {
        return this._sortLine(this.pageLines);
    }
});
