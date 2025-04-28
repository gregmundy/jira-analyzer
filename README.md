# Jira Metrics Dashboard

A simple vanilla JavaScript application that connects to your Jira instance and displays useful metrics about your tickets.

## Features

- Total ticket count
- Average resolution time
- Open vs Closed ticket visualization
- Priority distribution chart
- Recent tickets table with direct links

## Setup

1. Clone this repository
2. Open `index.html` in your web browser
3. Enter your Jira credentials:
   - Jira URL (e.g., https://your-domain.atlassian.net)
   - Email (your Jira account email)
   - API Token (see below for how to generate one)

## Generating a Jira API Token

1. Log in to your Atlassian account
2. Go to https://id.atlassian.com/manage/api-tokens
3. Click "Create API token"
4. Give your token a name and copy it
5. Use this token in the application (you won't be able to see it again)

## Security Note

This application runs entirely in the browser and does not store any credentials. All API calls are made directly from your browser to Jira.

## Browser Compatibility

This application uses modern JavaScript features and is compatible with:
- Chrome (latest)
- Firefox (latest)
- Safari (latest)
- Edge (latest)

## Limitations

- Currently fetches the 50 most recent tickets
- Metrics are calculated based on the fetched tickets only
- Requires CORS to be enabled on your Jira instance

## Customization

You can modify the JQL query in `script.js` to fetch different sets of tickets by changing the query in the `fetchJiraData` method. 