const strength = require('./strength');
const timing = require('./timing');
const crackPlan = require('./crackPlan');
const attempts = require('./attempts');

module.exports = {
  ...strength,
  ...timing,
  ...crackPlan,
  ...attempts,
};
