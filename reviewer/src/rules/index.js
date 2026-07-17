const security = require('./security');
const errorHandling = require('./errorHandling');
const missingTests = require('./missingTests');
const performance = require('./performance');
const style = require('./style');

module.exports = [security, errorHandling, missingTests, performance, style];
