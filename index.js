require('dotenv').config();

const readline = require('readline');
const fs = require('fs');
const { Octokit } = require('@octokit/rest');

const requiredEnvVars = ['OWNER', 'REPO', 'GITHUB_TOKEN'];
const allRequiredVarsPresent = requiredEnvVars.every(envVar => !!process.env[envVar]);

if (!allRequiredVarsPresent) {
  console.log('One of the required environment variables is not specified', requiredEnvVars.join(', '));
  process.exit(1);
}

const github = new Octokit({
  auth: process.env.GITHUB_TOKEN
});

// IMPROTANT: all forbidden branch names go here!!!
// so do not delete them accidentally
const BLACKLISTED_REFS = ['master', 'staging'];

// 30 days in seconds
const MONTH_IN_SECONDS = 2592000;

const AGE_IN_MONTHS = parseInt(process.env.AGE_IN_MONTHS, 10) || 3;

// PR age
const PR_MAX_AGE = AGE_IN_MONTHS * MONTH_IN_SECONDS;

// maximum number of processed PRs
const MAX_COUNT = parseInt(process.env.MAX_COUNT, 10) || 100;

// number of PRs to fetch per page
const PER_PAGE_COUNT = parseInt(process.env.PER_PAGE_COUNT, 10) || 30;

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Type DRYRUN (default) or NUKE to select a mode. DRYRUN does nothing, just logs: ', (mode) => {
  if (!mode) {
    // default mode if not specified
    // so play it safe
    mode = 'DRYRUN';
  }

  if (!['DRYRUN', 'NUKE'].includes(mode)) {
    console.log('Unsupported mode. Exiting');
    rl.close();
    process.exit(1);
  }

  console.log(`Mode selected: ${mode}`);

  const questionText = mode === 'DRYRUN'
    ? 'Hit ENTER to continue '
    : 'Are you sure you want to continue. Type YES I DO to continue? ';

  rl.question(questionText, async (answer) => {
    if (mode === 'NUKE' && answer !== 'YES I DO') {
      console.log('Exiting... your branches are safe... maybe.');
      rl.close();
      process.exit(1);
    }

    console.log('There is no turning back now hehe...');

    const baseConfig = {
      owner: process.env.OWNER,
      repo: process.env.REPO,
    };

    const config = {
      ...baseConfig,
      state: 'closed',
      sort: 'updated',
      direction: 'desc',
      page: 1,
      per_page: PER_PAGE_COUNT
    };

    let mergedPRs = [];

    for (;;) {
      console.log(`Page ${config.page}, getting closed PRs...`);

      const pulls = await github.rest.pulls.list(config);

      // exit if no data present
      if (!pulls.data || !pulls.data.length) {
        console.log('No more PRs to process or fetch');
        break;
      }

      const pullRequests = pulls.data
        // get only merged branches which are not included in our blacklist
        // TODO compare dates here to get only stale merged PRs
        .filter(pr => !!pr.merged_at && !BLACKLISTED_REFS.includes(pr.head.ref))
        .map(pr => {
          return {
            state: pr.state,
            number: pr.number,
            title: pr.title,
            html_url: pr.html_url,
            branch_name: pr.head.ref,
            merged_at: pr.merged_at,
          }
        });

      mergedPRs = mergedPRs.concat(pullRequests);

      if (mergedPRs >= MAX_COUNT) {
        console.log(`Maximum allowed amount (${MAX_COUNT}) of PRs is reached`)
        break;
      }

      console.log(`${pullRequests.length} merged PRs are processed`);
      config.page = config.page + 1;
    }

    // store data locally
    // comment the next line out if not needed
    fs.writeFileSync('./merged-prs.json', JSON.stringify(mergedPRs, null, 2));

    console.log(`Got ${mergedPRs.length} merged PRs`);

    if (mode === 'NUKE') {
      rl.question('Getting ready for actually removing branches. Confirm this action by typing NUKE. Note that this action cannot be updone: ', async (confirm) => {
        if (confirm !== 'NUKE') {
          rl.close();
          console.log('Exiting');
          process.exit();
        }

        for (const mergedPR of mergedPRs) {
          console.log(`Attempting to remove ${mergedPR.branch_name}`);
          try {
            await github.rest.git.deleteRef({
              ...baseConfig,
              ref: margedPR.branch_name,
            });
            console.log('Done');
          } catch (e) {
            console.log(`An error occued while deleting ${mergedPR.html_url} head branch: ${mergedPR.branch_name}`);
          }
        }
        rl.close();
      });
    } else {
      console.log('Going to wipe out ALL your branches hehe.. kidding just logging ;)');
      for (const mergedPR of mergedPRs) {
        console.log(`Attempting to remove ${mergedPR.branch_name}`);
        const age = Math.floor((Date.now() - Date.parse(mergedPR.merged_at)) / 1000);
        const monthsAge = Math.floor(Date.parse(mergedPR.merged_at) / 1000 / PR_MAX_AGE);
        console.log(`This PR (#${mergedPR.number}) is ${monthsAge} months old and is ${age > PR_MAX_AGE ? 'stale' : 'still fresh'}.`)
      }
      rl.close();
    }
  });
})
