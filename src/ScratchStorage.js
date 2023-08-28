const log = require('./log');

const BuiltinHelper = require('./BuiltinHelper');
const FirebaseHelper = require('./FirebaseHelper');

const _Asset = require('./Asset');
const _AssetType = require('./AssetType');
const _DataFormat = require('./DataFormat');
const _scratchFetch = require('./scratchFetch');

class ScratchStorage {
    constructor () {
        this.defaultAssetId = {};

        this.builtinHelper = new BuiltinHelper(this);
        this.firebaseHelper = new FirebaseHelper(this);
        this.builtinHelper.registerDefaultAssets(this);

        this._helpers = [
            {
                helper: this.builtinHelper,
                priority: 100
            },
            {
                helper: this.firebaseHelper,
                priority: -100
            }
        ];
    }

    /**
     * @return {Asset} - the `Asset` class constructor.
     * @constructor
     */
    get Asset () {
        return _Asset;
    }

    /**
     * @return {AssetType} - the list of supported asset types.
     * @constructor
     */
    get AssetType () {
        return _AssetType;
    }

    /**
     * @return {DataFormat} - the list of supported data formats.
     * @constructor
     */
    get DataFormat () {
        return _DataFormat;
    }

    /**
     * Access the `scratchFetch` module within this library.
     * @return {module} the scratchFetch module, with properties for `scratchFetch`, `setMetadata`, etc.
     */
    get scratchFetch () {
        return _scratchFetch;
    }

    /**
     * @deprecated Please use the `Asset` member of a storage instance instead.
     * @return {Asset} - the `Asset` class constructor.
     * @constructor
     */
    static get Asset () {
        return _Asset;
    }

    /**
     * @deprecated Please use the `AssetType` member of a storage instance instead.
     * @return {AssetType} - the list of supported asset types.
     * @constructor
     */
    static get AssetType () {
        return _AssetType;
    }

    /**
     * Add a storage helper to this manager. Helpers with a higher priority number will be checked first when loading
     * or storing assets. For comparison, the helper for built-in assets has `priority=100` and the default web helper
     * has `priority=-100`. The relative order of helpers with equal priorities is undefined.
     * @param {Helper} helper - the helper to be added.
     * @param {number} [priority] - the priority for this new helper (default: 0).
     */
    addHelper (helper, priority = 0) {
        this._helpers.push({helper, priority});
        this._helpers.sort((a, b) => b.priority - a.priority);
    }

    /**
     * Synchronously fetch a cached asset from built-in storage. Assets are cached when they are loaded.
     * @param {string} assetId - The id of the asset to fetch.
     * @returns {?Asset} The asset, if it exists.
     */
    get (assetId) {
        return this.builtinHelper.get(assetId);
    }

    /**
     * Deprecated API for caching built-in assets. Use createAsset.
     * @param {AssetType} assetType - The type of the asset to cache.
     * @param {DataFormat} dataFormat - The dataFormat of the data for the cached asset.
     * @param {Buffer} data - The data for the cached asset.
     * @param {string} id - The id for the cached asset.
     * @returns {string} The calculated id of the cached asset, or the supplied id if the asset is mutable.
     */
    cache (assetType, dataFormat, data, id) {
        log.warn('Deprecation: Storage.cache is deprecated. Use Storage.createAsset, and store assets externally.');
        return this.builtinHelper._store(assetType, dataFormat, data, id);
    }

    /**
     * Construct an Asset, and optionally generate an md5 hash of its data to create an id
     * @param {AssetType} assetType - The type of the asset to cache.
     * @param {DataFormat} dataFormat - The dataFormat of the data for the cached asset.
     * @param {Buffer} data - The data for the cached asset.
     * @param {string} [id] - The id for the cached asset.
     * @param {bool} [generateId] - flag to set id to an md5 hash of data if `id` isn't supplied
     * @returns {Asset} generated Asset with `id` attribute set if not supplied
     */
    createAsset (assetType, dataFormat, data, id, generateId) {
        if (!dataFormat) throw new Error('Tried to create asset without a dataFormat');
        return new _Asset(assetType, id, dataFormat, data, generateId);
    }

    /**
     * Register a web-based store for assets. Sources will be checked in order of registration.
     * @param {Array.<AssetType>} types - The types of asset provided by this store.
     * @param {FirebaseStorage} firebaseStorage - A firebase storage object.
     * @param {string} path - path to the storage folder.
     */
    addFirebaseStore (types, firebaseStorage, path = '') {
        this.firebaseHelper.addStore(types, firebaseStorage, path);
    }

    /**
     * Fetch an asset by type & ID.
     * @param {AssetType} assetType - The type of asset to fetch. This also determines which asset store to use.
     * @param {string} assetId - The ID of the asset to fetch: a project ID, MD5, etc.
     * @param {DataFormat} [dataFormat] - Optional: load this format instead of the AssetType's default.
     * @return {Promise.<Asset>} A promise for the requested Asset.
     *   If the promise is resolved with non-null, the value is the requested asset.
     *   If the promise is resolved with null, the desired asset could not be found with the current asset sources.
     *   If the promise is rejected, there was an error on at least one asset source. HTTP 404 does not count as an
     *   error here, but (for example) HTTP 403 does.
     */
    load (assetType, assetId, dataFormat) {
        /** @type {Helper[]} */
        const helpers = this._helpers.map(x => x.helper);
        const errors = [];
        dataFormat = dataFormat || assetType.runtimeFormat;

        let helperIndex = 0;
        let helper;
        const tryNextHelper = err => {
            if (err) { // Track the error, but continue looking
                errors.push(err);
            }

            helper = helpers[helperIndex++];

            if (helper) {
                const loading = helper.load(assetType, assetId, dataFormat);
                if (loading === null) {
                    return tryNextHelper();
                }
                // Note that other attempts may have logged errors; if this succeeds they will be suppressed.
                return loading
                    // TODO: maybe some types of error should prevent trying the next helper?
                    .catch(tryNextHelper);
            } else if (errors.length > 0) {
                // We looked through all the helpers and couldn't find the asset, AND
                // at least one thing went wrong while we were looking.
                return Promise.reject(errors);
            }

            // Nothing went wrong but we couldn't find the asset.
            return Promise.resolve(null);
        };

        return tryNextHelper();
    }

    /**
     * Store an asset by type & ID.
     * @param {AssetType} assetType - The type of asset to fetch. This also determines which asset store to use.
     * @param {?DataFormat} [dataFormat] - Optional: load this format instead of the AssetType's default.
     * @param {Buffer} data - Data to store for the asset
     * @param {?string} [assetId] - The ID of the asset to fetch: a project ID, MD5, etc.
     * @return {Promise.<object>} A promise for asset metadata
     */
    store (assetType, dataFormat, data, assetId) {
        dataFormat = dataFormat || assetType.runtimeFormat;
        return new Promise(
            (resolve, reject) =>
                this.firebaseHelper.store(assetType, dataFormat, data, assetId)
                    .then(body => {
                        this.builtinHelper._store(assetType, dataFormat, data, body.id);
                        return resolve(body);
                    })
                    .catch(error => reject(error))
        );
    }
}

module.exports = ScratchStorage;
