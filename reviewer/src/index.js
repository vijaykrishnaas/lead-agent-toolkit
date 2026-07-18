module.exports = {
  ...require('./reviewer'),
  ...require('./config/loadRules'),
  ...require('./format/markdownReport'),
  ...require('./github/postReviewComment'),
  ...require('./standup'),
  ...require('./docDrift'),
};
