const Asset = require('./Asset');
const Helper = require('./Helper');
const ProxyTool = require('./ProxyTool');

const {ref, getBytes, uploadBytes} = require('firebase/storage');

/**
 * @typedef {function} UrlFunction - A function which computes a URL from asset information.
 * @param {Asset} - The asset for which the URL should be computed.
 * @returns {(string|object)} - A string representing the URL for the asset request OR an object with configuration for
 *                              the underlying fetch call (necessary for configuring e.g. authentication)
 */

class FirebaseHelper extends Helper {
    constructor (parent) {
        super(parent);

        /**
         * @type {Array.<StoreRecord>}
         * @typedef {object} StoreRecord
         * @property {Array.<string>} types - The types of asset provided by this store, from AssetType's name field.
         * @property {UrlFunction} getFunction - A function which computes a URL from an Asset.
         * @property {UrlFunction} createFunction - A function which computes a URL from an Asset.
         * @property {UrlFunction} updateFunction - A function which computes a URL from an Asset.
         */
        this.stores = [];

        /**
         * Set of tools to best load many assets in parallel. If one tool
         * cannot be used, it will use the next.
         * @type {ProxyTool}
         */
        this.assetTool = new ProxyTool();

        /**
         * Set of tools to best load project data in parallel with assets. This
         * tool set prefers tools that are immediately ready. Some tools have
         * to initialize before they can load files.
         * @type {ProxyTool}
         */
        this.projectTool = new ProxyTool(ProxyTool.TOOL_FILTER.READY);
    }

    /**
     * Register a web-based store for assets. Sources will be checked in order of registration.
     * @param {Array.<AssetType>} types - The types of asset provided by this store.
     * @param {StorageReference} firebaseStorageReference - A firebase storage object.
     * @param {string} path - path to the storage folder.
     */
    addStore (types, firebaseStorageReference) {
        this.stores.push({
            types: types.map(assetType => assetType.name),
            storageReference: firebaseStorageReference
        });
    }

    /**
     * Fetch an asset but don't process dependencies.
     * @param {AssetType} assetType - The type of asset to fetch.
     * @param {string} assetId - The ID of the asset to fetch: a project ID, MD5, etc.
     * @param {DataFormat} dataFormat - The file format / file extension of the asset to fetch: PNG, JPG, etc.
     * @return {Promise.<Asset>} A promise for the contents of the asset.
     */
    load (assetType, assetId, dataFormat) {

        /** @type {Array.<{url:string, result:*}>} List of URLs attempted & errors encountered. */
        const errors = [];
        const stores = this.stores.slice()
            .filter(store => store.types.indexOf(assetType.name) >= 0);
        
        // New empty asset but it doesn't have data yet
        const asset = new Asset(assetType, assetId, dataFormat);

        if (assetType.name === 'Project') {
            console.warn('Project loading is not supported yet');
            return;
        }

        let storeIndex = 0;
        const tryNextSource = err => {
            if (err) {
                errors.push(err);
            }
            const store = stores[storeIndex++];
            if (!store) {
                // no more stores to try
                return Promise.reject(errors);
            }

            const storageRef = store.storageReference;
            const assetRef = ref(storageRef, `${assetId}.${dataFormat}`);

            getBytes(assetRef).then(buffer => {
                if (buffer) {
                    asset.setData(buffer);
                    return asset;
                }
                return tryNextSource();
            });

            console.warn('Asset not found in Firebase storage');
        };

        return tryNextSource();
    }

    /**
     * Create or update an asset with provided data. The create function is called if no asset id is provided
     * @param {AssetType} assetType - The type of asset to create or update.
     * @param {?DataFormat} dataFormat - DataFormat of the data for the stored asset.
     * @param {Buffer} data - The data for the cached asset.
     * @param {?string} assetId - The ID of the asset to fetch: a project ID, MD5, etc.
     * @return {Promise.<object>} A promise for the response from the create or update request
     */
    store (assetType, dataFormat, data, assetId) {
        // If we have an asset id, we should update, otherwise create to get an id
        const create = assetId === '' || assetId === null || typeof assetId === 'undefined';

        // Use the first store with the appropriate asset type and url function
        const store = this.stores.filter(s =>
            // Only use stores for the incoming asset type
            s.types.indexOf(assetType.name) !== -1 && (
                // Only use stores that have a create function if this is a create request
                // or an update function if this is an update request
                (create && s.create) || s.update
            )
        )[0];

        if (!store) return Promise.reject(new Error('No appropriate stores'));

        if (assetType.name === 'Project') {
            console.warn('Project loading is not supported yet');
            return;
        }

        const storageRef = store.storageReference;
        const assetRef = ref(storageRef, assetId);
        return uploadBytes(assetRef, data);

    }
}

module.exports = FirebaseHelper;
