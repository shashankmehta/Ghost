var dataExport       = require('../data/export'),
    dataImport       = require('../data/import'),
    dataProvider     = require('../models'),
    fs               = require('fs-extra'),
    path             = require('path'),
    when             = require('when'),
    nodefn           = require('when/node/function'),
    _                = require('lodash'),
    schema           = require('../data/schema').tables,
    config           = require('../config'),
    errors           = require('../../server/errorHandling'),
    api              = {},
    db;

api.notifications    = require('./notifications');
api.settings         = require('./settings');

db = {
    'exportContent': function () {
        // Export data, otherwise send error 500
        return dataExport().otherwise(function (error) {
            return when.reject({errorCode: 500, message: error.message || error});
        });
    },
    'importContent': function (options) {
        var databaseVersion;

        if (!options.importfile || !options.importfile.path || options.importfile.name.indexOf('json') === -1) {
            /**
             * Notify of an error if it occurs
             *
             * - If there's no file (although if you don't select anything, the input is still submitted, so
             *   !req.files.importfile will always be false)
             * - If there is no path
             * - If the name doesn't have json in it
             */
            return when.reject({errorCode: 500, message: 'Please select a .json file to import.'});
        }

        return api.settings.read({ key: 'databaseVersion' }).then(function (setting) {
            return when(setting.value);
        }, function () {
            return when('001');
        }).then(function (version) {
            databaseVersion = version;
            // Read the file contents
            return nodefn.call(fs.readFile, options.importfile.path);
        }).then(function (fileContents) {
            var importData,
                error = '',
                tableKeys = _.keys(schema);

            // Parse the json data
            try {
                importData = JSON.parse(fileContents);
            } catch (e) {
                errors.logError(e, "API DB import content", "check that the import file is valid JSON.");
                return when.reject(new Error("Failed to parse the import JSON file"));
            }

            if (!importData.meta || !importData.meta.version) {
                return when.reject(new Error("Import data does not specify version"));
            }

            _.each(tableKeys, function (constkey) {
                _.each(importData.data[constkey], function (elem) {
                    var prop;
                    for (prop in elem) {
                        if (elem.hasOwnProperty(prop)) {
                            if (schema[constkey].hasOwnProperty(prop)) {
                                if (!_.isNull(elem[prop])) {
                                    if (elem[prop].length > schema[constkey][prop].maxlength) {
                                        error += error !== "" ? "<br>" : "";
                                        error += "Property '" + prop + "' exceeds maximum length of " + schema[constkey][prop].maxlength + " (element:" + constkey + " / id:" + elem.id + ")";
                                    }
                                } else {
                                    if (!schema[constkey][prop].nullable) {
                                        error += error !== "" ? "<br>" : "";
                                        error += "Property '" + prop + "' is not nullable (element:" + constkey + " / id:" + elem.id + ")";
                                    }
                                }
                            } else {
                                error += error !== "" ? "<br>" : "";
                                error += "Property '" + prop + "' is not allowed (element:" + constkey + " / id:" + elem.id + ")";
                            }
                        }
                    }
                });
            });

            if (error !== "") {
                return when.reject(new Error(error));
            }
            // Import for the current version
            return dataImport(databaseVersion, importData);

        }).then(function importSuccess() {
            return api.settings.updateSettingsCache();
        }).then(function () {
            return when.resolve({message: 'Posts, tags and other data successfully imported'});
        }).otherwise(function importFailure(error) {
            return when.reject({errorCode: 500, message: error.message || error});
        });
    },
    'deleteAllContent': function () {
        return when(dataProvider.deleteAllContent())
            .then(function () {
                return when.resolve({message: 'Successfully deleted all content from your blog.'});
            }, function (error) {
                return when.reject({errorCode: 500, message: error.message || error});
            });
    }
};

module.exports = db;
