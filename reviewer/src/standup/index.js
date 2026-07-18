module.exports = {
  ...require('./collectCommits'),
  ...require('./collectPullRequests'),
  ...require('./groupByAuthor'),
  ...require('./formatStandup'),
  ...require('./generateStandup'),
};
