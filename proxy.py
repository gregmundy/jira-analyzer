from flask import Flask, request, jsonify
import requests
from flask_cors import CORS
import base64
import logging
import os
import json
from datetime import datetime, timezone

# Set up logging
logging.basicConfig(level=logging.DEBUG)
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)  # Enable CORS for all routes

# Hardcoded credentials - in a real app these would come from env vars or a secure store
JIRA_CREDENTIALS = {
    'jira_url': os.environ.get('JIRA_URL', 'https://hometap.atlassian.net'),
    'email': os.environ.get('JIRA_EMAIL', ''),
    'api_token': os.environ.get('JIRA_API_TOKEN', '')
}

# Aging thresholds in hours for different statuses
AGING_THRESHOLDS = {
    'In Progress': int(os.environ.get('AGING_THRESHOLD_IN_PROGRESS', 72)),  # Default: 3 days
    'In Review': int(os.environ.get('AGING_THRESHOLD_IN_REVIEW', 72)),      # Default: 3 days
    'In QA': int(os.environ.get('AGING_THRESHOLD_IN_QA', 72)),              # Default: 3 days
    'Code Review': int(os.environ.get('AGING_THRESHOLD_CODE_REVIEW', 72)),  # Default: 3 days
    'Testing': int(os.environ.get('AGING_THRESHOLD_TESTING', 72)),          # Default: 3 days
    'Ready for Review': int(os.environ.get('AGING_THRESHOLD_READY_FOR_REVIEW', 72))  # Default: 3 days
}

@app.route('/config', methods=['GET'])
def get_config():
    """Return backend configuration including Jira URL (but not credentials)"""
    return jsonify({
        'jira_url': JIRA_CREDENTIALS['jira_url']
    })

@app.route('/aging-thresholds', methods=['GET'])
def get_aging_thresholds():
    """Return the configured aging thresholds for different statuses"""
    return jsonify(AGING_THRESHOLDS)

@app.route('/proxy/serverInfo', methods=['GET'])
def proxy_server_info():
    """Check connection to Jira server using backend credentials"""
    try:
        # Use backend credentials
        jira_url = JIRA_CREDENTIALS['jira_url']
        email = JIRA_CREDENTIALS['email']
        api_token = JIRA_CREDENTIALS['api_token']
        
        if not email or not api_token:
            logger.error("Jira credentials not configured in backend")
            return jsonify({'error': 'Jira credentials not configured in backend'}), 500
            
        # Create auth header
        auth_header = f"Basic {base64.b64encode(f'{email}:{api_token}'.encode()).decode()}"
        
        # Prepare headers for Jira
        jira_headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        # According to Jira REST API v3 docs, the proper endpoint is /rest/api/3/serverInfo
        full_url = f"{jira_url}/rest/api/3/serverInfo"
        logger.debug(f"Making serverInfo request to: {full_url}")
        logger.debug(f"With headers: {jira_headers}")
        
        response = requests.get(full_url, headers=jira_headers)
        
        # Log response details for debugging
        logger.debug(f"Jira serverInfo response status: {response.status_code}")
        logger.debug(f"Jira serverInfo response headers: {response.headers}")
        logger.debug(f"Jira serverInfo response content: {response.content[:500]}...")
        
        # Try to parse the response as JSON, but first check if we received JSON
        content_type = response.headers.get('Content-Type', '')
        if 'application/json' not in content_type and response.content:
            logger.error(f"Received non-JSON response: {content_type}")
            return jsonify({
                'error': f'Received non-JSON response from Jira: {content_type}',
                'details': response.text
            }), response.status_code
            
        try:
            if response.content:
                response_data = response.json()
            else:
                response_data = {'message': 'Empty response from Jira'}
        except ValueError:
            logger.error(f"Failed to parse serverInfo response as JSON: {response.text}")
            return jsonify({
                'error': 'Failed to parse Jira response',
                'details': response.text
            }), 500
            
        if response.status_code >= 400:
            logger.error(f"Jira API error: {response.status_code} - {response_data}")
            return jsonify({
                'error': f'Jira API returned {response.status_code}',
                'details': response_data
            }), response.status_code
            
        return jsonify(response_data), response.status_code
    except requests.exceptions.RequestException as e:
        logger.error(f"Error connecting to Jira: {str(e)}")
        return jsonify({'error': f'Failed to connect to Jira: {str(e)}'}), 500

@app.route('/proxy/<path:path>', methods=['GET', 'POST'])
def proxy(path):
    try:
        # Use backend credentials
        jira_url = JIRA_CREDENTIALS['jira_url']
        email = JIRA_CREDENTIALS['email']
        api_token = JIRA_CREDENTIALS['api_token']
        
        if not email or not api_token:
            logger.error("Jira credentials not configured in backend")
            return jsonify({'error': 'Jira credentials not configured in backend'}), 500
            
        # Create auth header
        auth_header = f"Basic {base64.b64encode(f'{email}:{api_token}'.encode()).decode()}"
        
        # Construct the full URL - Use API v3 instead of v2
        full_url = f"{jira_url}/rest/api/3/{path}"
        logger.debug(f"Making request to: {full_url}")
        
        # Prepare headers for Jira
        jira_headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        # Get params from request, excluding jira_url which we now get from backend
        params = {k: v for k, v in request.args.items() if k != 'jira_url'}
        
        # Special handling for the search endpoint which requires JQL in the request body
        json_data = None
        if path == 'search':
            # For the search endpoint, we need to pass JQL in the request body
            jql = params.pop('jql', '')
            
            # If no JQL provided, use a default sorting
            if not jql:
                jql = 'ORDER BY created DESC'
            
            max_results = params.pop('maxResults', 100)  # Increase from 50 to 100 (JIRA API maximum)
            
            # Check if we need to filter by a specific board/project
            board = params.pop('board', None)
            
            # If board is specified, add it to the JQL query
            if board:
                logger.debug(f"Filtering by board/project: {board}")
                if 'ORDER BY' in jql:
                    # Insert project filter before ORDER BY, fixing the syntax
                    order_part = jql.split('ORDER BY')
                    jql = f"project = {board} AND {order_part[0].strip()} ORDER BY {order_part[1].strip()}"
                else:
                    # Append project filter to existing JQL
                    jql = f"{jql} AND project = {board}"
            
            logger.debug(f"Using JQL query: {jql}")
            
            # Extract fields from request parameters if provided
            fields_param = params.pop('fields', 'summary,status,priority,created,updated,reporter,assignee,resolutiondate,labels,issuelinks')
            # Ensure fields_list is correctly formatted as a list of strings
            if isinstance(fields_param, str):
                fields_list = fields_param.split(',')  # Convert comma-separated string to list for JIRA API
            else:
                fields_list = fields_param
            
            # Ensure we have expanded changelog for status history
            expand = params.pop('expand', 'changelog')
            if isinstance(expand, str):
                expand = expand.split(',')
            
            # Add startAt parameter (required by JIRA API)
            start_at = params.pop('startAt', 0)
            
            json_data = {
                'jql': jql,
                'startAt': int(start_at),
                'maxResults': int(max_results),
                'fields': fields_list,
                'expand': expand
            }
            
            logger.debug(f"Search request body: {json_data}")
        elif request.is_json:
            json_data = request.get_json()
        
        # Forward the request to Jira
        response = requests.request(
            method='POST' if path == 'search' else request.method,
            url=full_url,
            headers=jira_headers,
            params=params,
            json=json_data,
            verify=True  # Enable SSL verification
        )
        
        logger.debug(f"Jira response status: {response.status_code}")
        logger.debug(f"Jira response headers: {response.headers}")
        logger.debug(f"Jira response text: {response.text[:500]}...")  # Log first 500 chars of response

        # Try to parse the response as JSON
        try:
            response_data = response.json()
        except ValueError:
            logger.error(f"Failed to parse response as JSON: {response.text}")
            return jsonify({
                'error': 'Failed to parse Jira response',
                'details': response.text
            }), 500

        if response.status_code >= 400:
            logger.error(f"Jira API error: {response.status_code} - {response_data}")
            return jsonify({
                'error': f'Jira API returned {response.status_code}',
                'details': response_data
            }), response.status_code

        return jsonify(response_data), response.status_code

    except requests.exceptions.RequestException as e:
        logger.error(f"Request error: {str(e)}")
        return jsonify({'error': f'Request failed: {str(e)}'}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/proxy/board-sprints', methods=['GET'])
def get_board_sprints():
    """Get sprints for a specific board"""
    try:
        # Use backend credentials
        jira_url = JIRA_CREDENTIALS['jira_url']
        email = JIRA_CREDENTIALS['email']
        api_token = JIRA_CREDENTIALS['api_token']
        
        if not email or not api_token:
            logger.error("Jira credentials not configured in backend")
            return jsonify({'error': 'Jira credentials not configured in backend'}), 500
            
        # Get board parameter
        board = request.args.get('board')
        if not board:
            return jsonify({'error': 'Board parameter is required'}), 400
            
        # Create auth header
        auth_header = f"Basic {base64.b64encode(f'{email}:{api_token}'.encode()).decode()}"
        
        # Prepare headers for Jira
        jira_headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }

        logger.debug(f"Fetching sprints for board: {board}")
        
        # First, find all boards associated with this project
        boards_url = f"{jira_url}/rest/agile/1.0/board?projectKeyOrId={board}"
        boards_response = requests.get(boards_url, headers=jira_headers)
        
        if boards_response.status_code >= 400:
            logger.error(f"Error fetching boards: {boards_response.status_code} - {boards_response.text}")
            return jsonify({'error': f'Failed to fetch boards: {boards_response.status_code}'}), boards_response.status_code
            
        boards_data = boards_response.json()
        
        if not boards_data.get('values') or len(boards_data.get('values', [])) == 0:
            logger.warning(f"No boards found for project: {board}")
            return jsonify({
                'sprints': [],
                'message': f"No boards found for project {board}. This project may not have an Agile board configured."
            }), 200
        
        # Try each board in sequence until we find one with sprints
        all_sprints = []
        boards_checked = 0
        boards_with_sprints = 0
        
        for board_info in boards_data.get('values', []):
            board_id = board_info.get('id')
            board_name = board_info.get('name')
            
            if not board_id:
                continue
                
            boards_checked += 1
            logger.debug(f"Checking board: {board_name} (ID: {board_id}) for sprints")
            
            # Fetch sprints for this board
            sprints_url = f"{jira_url}/rest/agile/1.0/board/{board_id}/sprint?state=active,closed,future"
            sprints_response = requests.get(sprints_url, headers=jira_headers)
            
            # Skip this board if there's an error
            if sprints_response.status_code >= 400:
                logger.warning(f"Error fetching sprints for board {board_name} (ID: {board_id}): {sprints_response.status_code}")
                continue
                
            sprints_data = sprints_response.json()
            sprints_for_board = sprints_data.get('values', [])
            
            if len(sprints_for_board) > 0:
                boards_with_sprints += 1
                logger.debug(f"Found {len(sprints_for_board)} sprints for board {board_name}")
                
                # Extract sprint info
                for sprint in sprints_for_board:
                    sprint_info = {
                        'id': sprint.get('id'),
                        'name': sprint.get('name'),
                        'state': sprint.get('state'),
                        'startDate': sprint.get('startDate'),
                        'endDate': sprint.get('endDate'),
                        'boardName': board_name  # Add board name for reference
                    }
                    all_sprints.append(sprint_info)
        
        # Provide a helpful message if we checked boards but found no sprints
        if boards_checked > 0 and len(all_sprints) == 0:
            logger.warning(f"Checked {boards_checked} boards for project {board} but found no sprints")
            return jsonify({
                'sprints': [],
                'message': f"No sprints found for any of the {boards_checked} boards in project {board}."
            }), 200
        
        # Helper function for safe sorting with None values
        def safe_sort_key(sprint):
            # If startDate is None or empty, use a minimum date string for sorting
            start_date = sprint.get('startDate')
            if not start_date:
                return "0000-00-00T00:00:00.000Z"  # Minimum date string for sorting
            return start_date
        
        # Sort all sprints by start date (descending) with safe handling of None values
        all_sprints.sort(key=safe_sort_key, reverse=True)
        
        logger.info(f"Returning {len(all_sprints)} sprints from {boards_with_sprints} boards (out of {boards_checked} checked) for project {board}")
        
        return jsonify({
            'sprints': all_sprints,
            'boardsChecked': boards_checked,
            'boardsWithSprints': boards_with_sprints
        }), 200
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error: {str(e)}")
        return jsonify({'error': f'Request failed: {str(e)}'}), 500
    except Exception as e:
        logger.error(f"Unexpected error: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())  # Add stack trace for better debugging
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/proxy/issue-history/<issue_key>', methods=['GET'])
def get_issue_history(issue_key):
    """Get detailed status and transition history for a specific issue"""
    try:
        # Use backend credentials
        jira_url = JIRA_CREDENTIALS['jira_url']
        email = JIRA_CREDENTIALS['email']
        api_token = JIRA_CREDENTIALS['api_token']
        
        if not email or not api_token:
            logger.error("Jira credentials not configured in backend")
            return jsonify({'error': 'Jira credentials not configured in backend'}), 500
            
        # Create auth header
        auth_header = f"Basic {base64.b64encode(f'{email}:{api_token}'.encode()).decode()}"
        
        # Prepare headers for Jira
        jira_headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        # Get the issue detail with changelog to analyze history
        issue_url = f"{jira_url}/rest/api/3/issue/{issue_key}?expand=changelog"
        logger.debug(f"Getting issue history for {issue_key} from {issue_url}")
        
        response = requests.get(issue_url, headers=jira_headers)
        
        if response.status_code >= 400:
            logger.error(f"Error fetching issue history: {response.status_code} - {response.text}")
            return jsonify({'error': f'Failed to fetch issue history: {response.status_code}'}), response.status_code
            
        issue_data = response.json()
        
        # Extract just the status changes from the changelog
        status_changes = []
        status_durations = {}
        current_status = None
        last_status_change_date = None
        
        # First, get creation date as the starting point
        created_date = issue_data.get('fields', {}).get('created')
        if created_date:
            # Get initial status if available (usually "To Do" or equivalent)
            initial_status = issue_data.get('fields', {}).get('status', {}).get('name')
            if initial_status:
                current_status = initial_status
                last_status_change_date = created_date
                
                # Add the initial status to the status changes
                status_changes.append({
                    'date': created_date,
                    'from': None,
                    'to': initial_status,
                    'fromCategory': None,
                    'toCategory': initial_status
                })
        
        # Build a chronological list of all status transitions
        all_status_transitions = []
        
        # Go through each changelog entry to find status changes
        changelog_entries = issue_data.get('changelog', {}).get('histories', [])
        for entry in changelog_entries:
            created = entry.get('created')
            author = entry.get('author', {}).get('displayName', 'Unknown')
            
            for item in entry.get('items', []):
                field = item.get('field')
                
                if field == 'status':
                    from_status = item.get('fromString')
                    to_status = item.get('toString')
                    
                    # Add this transition to our chronological list
                    all_status_transitions.append({
                        'date': created,
                        'from': from_status,
                        'to': to_status,
                        'author': author
                    })
                    
                    # Add this status change to our list
                    status_changes.append({
                        'date': created,
                        'from': from_status,
                        'to': to_status,
                        'author': author,
                        'fromCategory': from_status,
                        'toCategory': to_status
                    })
        
        # Sort transitions chronologically
        all_status_transitions.sort(key=lambda x: x['date'])
        
        # Now process transitions to calculate durations
        status_periods = {}  # Track periods spent in each status
        now = datetime.now(timezone.utc)
        
        # Initialize with the first status if we have it
        if current_status and last_status_change_date:
            current_period_start = datetime.fromisoformat(last_status_change_date.replace('Z', '+00:00'))
            current_period_status = current_status
        else:
            # If we don't have initial status, we can't calculate durations accurately
            return jsonify({
                'key': issue_key,
                'summary': issue_data.get('fields', {}).get('summary', 'No summary'),
                'status_changes': status_changes,
                'status_durations': {},
                'error': 'Unable to determine initial status',
                'current_status': issue_data.get('fields', {}).get('status', {}).get('name'),
                'created': created_date,
                'resolution_date': issue_data.get('fields', {}).get('resolutiondate')
            })
        
        # Process each transition to calculate time in each status
        for transition in all_status_transitions:
            transition_date = datetime.fromisoformat(transition['date'].replace('Z', '+00:00'))
            from_status = transition['from']
            to_status = transition['to']
            
            # Calculate duration in previous status
            duration_hours = (transition_date - current_period_start).total_seconds() / 3600
            
            # Add to periods for this status
            if current_period_status not in status_periods:
                status_periods[current_period_status] = []
            
            status_periods[current_period_status].append({
                'start': current_period_start,
                'end': transition_date,
                'duration_hours': duration_hours
            })
            
            # Update for next period
            current_period_start = transition_date
            current_period_status = to_status
        
        # Add the final period (from last transition to now)
        duration_hours = (now - current_period_start).total_seconds() / 3600
        if current_period_status not in status_periods:
            status_periods[current_period_status] = []
        
        status_periods[current_period_status].append({
            'start': current_period_start,
            'end': now,
            'duration_hours': duration_hours,
            'is_current': True
        })
        
        # Calculate aggregated durations for each status
        for status, periods in status_periods.items():
            total_hours = sum(period['duration_hours'] for period in periods)
            current_period = next((period for period in periods if period.get('is_current', False)), None)
            
            status_durations[status] = {
                'total_hours': total_hours,
                'count': len(periods),
                'average_hours': total_hours / len(periods),
                'periods': periods
            }
            
            # Add current_duration only if this is the current status
            if current_period:
                status_durations[status]['current_duration'] = current_period['duration_hours']
                status_durations[status]['continuous_time'] = current_period['duration_hours']
                
                # Log especially long durations in important statuses
                if status in ['In Progress', 'In Review', 'In QA'] and current_period['duration_hours'] >= 72:
                    logger.warning(f"Issue {issue_key} has been in {status} continuously for {round(current_period['duration_hours'], 2)} hours (3+ days)")
        
        # Prepare response with relevant data
        result = {
            'key': issue_key,
            'summary': issue_data.get('fields', {}).get('summary', 'No summary'),
            'status_changes': status_changes,
            'status_durations': status_durations,
            'current_status': current_period_status,
            'created': created_date,
            'resolution_date': issue_data.get('fields', {}).get('resolutiondate')
        }
        
        return jsonify(result)
    except Exception as e:
        logger.error(f"Error processing issue history: {str(e)}")
        return jsonify({'error': f'Error processing issue history: {str(e)}'}), 500

@app.route('/proxy/resolution-metrics', methods=['GET'])
def get_resolution_metrics():
    """Calculate average cycle times between key workflow states for all tickets"""
    try:
        # Use backend credentials
        jira_url = JIRA_CREDENTIALS['jira_url']
        email = JIRA_CREDENTIALS['email']
        api_token = JIRA_CREDENTIALS['api_token']
        
        if not email or not api_token:
            logger.error("Jira credentials not configured in backend")
            return jsonify({'error': 'Jira credentials not configured in backend'}), 500
            
        # Get query parameters - we'll analyze ALL tickets now, not just done ones
        jql = request.args.get('jql', 'ORDER BY created DESC')
        max_results = int(request.args.get('maxResults', '200'))  # Increased to get more data
        board = request.args.get('board')
        
        # If board is specified, add it to the JQL query
        if board:
            logger.debug(f"Filtering by board/project: {board}")
            if 'ORDER BY' in jql:
                order_part = jql.split('ORDER BY')
                jql = f"project = {board} AND ({order_part[0].strip()}) ORDER BY {order_part[1].strip()}"
            else:
                jql = f"project = {board} AND ({jql})"
                
        logger.debug(f"Using JQL query for metrics: {jql}")
            
        # Create auth header
        auth_header = f"Basic {base64.b64encode(f'{email}:{api_token}'.encode()).decode()}"
        
        # Prepare headers for Jira
        jira_headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        
        # Fetch all issues with changelog to analyze status durations
        search_url = f"{jira_url}/rest/api/3/search"
        search_body = {
            'jql': jql,
            'maxResults': max_results,
            'startAt': 0,
            'fields': ['created', 'resolutiondate', 'status', 'updated', 'summary'],
            'expand': ['changelog']
        }
        
        logger.debug(f"Resolution metrics search request body: {search_body}")
        search_response = requests.post(search_url, headers=jira_headers, json=search_body)
        
        if search_response.status_code >= 400:
            logger.error(f"Error fetching issues for metrics: {search_response.status_code} - {search_response.text}")
            return jsonify({'error': f'Failed to fetch issues: {search_response.status_code}'}), search_response.status_code
            
        issues_data = search_response.json()
        issues = issues_data.get('issues', [])
        
        logger.debug(f"Found {len(issues)} issues for analysis")
        
        # Define status categories for transition tracking
        status_categories = {
            'to_do': ['TO DO', 'To Do', 'Backlog', 'Open', 'New', 'Product Backlog'],
            'in_progress': ['IN PROGRESS', 'In Progress', 'Development', 'Implementing', 'Dev', 'Coding'],
            'in_review': ['IN REVIEW', 'In Review', 'Code Review', 'Review', 'Reviewing', 'PR Review'],
            'in_qa': ['IN QA', 'In QA', 'QA', 'Testing', 'Validation', 'Test'],
            'done': ['DONE', 'Done', 'Closed', 'Resolved', 'Completed', 'Fixed']
        }
        
        # Define the cycle times using exact status names
        cycle_times = {
            'Development': {'total_hours': 0, 'count': 0, 'description': 'Time from TO DO to IN PROGRESS'},
            'Review': {'total_hours': 0, 'count': 0, 'description': 'Time from IN PROGRESS to IN REVIEW'},
            'QA': {'total_hours': 0, 'count': 0, 'description': 'Time from IN REVIEW to IN QA'},
            'Completion': {'total_hours': 0, 'count': 0, 'description': 'Time from IN QA to DONE'},
            'Total': {'total_hours': 0, 'count': 0, 'description': 'Total time from TO DO to DONE'}
        }
        
        # Counters for overall metrics
        total_issues = len(issues)
        completed_issues = 0
        in_progress_issues = 0
        
        # Track active tickets in each stage
        current_status_counts = {
            'to_do': 0,
            'in_progress': 0,
            'in_review': 0,
            'in_qa': 0,
            'done': 0,
            'other': 0
        }
        
        # Track tickets with partial transitions
        partial_transitions = {
            'Development': 0,
            'Review': 0,
            'QA': 0,
            'Completion': 0
        }
        
        # Track ping-pong transitions (back and forth between states)
        ping_pong_metrics = {
            'total_ping_pongs': 0,                    # Total number of backward transitions
            'tickets_with_ping_pongs': 0,             # Number of tickets with any backward transitions
            'ping_pong_details': {                    # Counts of different types of backward transitions
                'in_progress_to_to_do': 0,
                'in_review_to_in_progress': 0,
                'in_qa_to_in_review': 0,
                'in_qa_to_in_progress': 0,
                'done_to_any': 0
            },
            'tickets_by_score': {                    # Tickets grouped by ping-pong score range
                '1-5': 0,
                '6-10': 0,
                '11-20': 0,
                '21+': 0
            },
            'tickets_with_scores': {}                # Dictionary of ticket keys to their ping-pong scores
        }
        
        # Track all status names encountered
        all_status_names = set()
        status_category_map = {}  # Maps actual status names to our categories
        
        # Analyze each issue to calculate cycle times
        for issue in issues:
            issue_key = issue.get('key')
            changelog = issue.get('changelog', {}).get('histories', [])
            created_date = issue.get('fields', {}).get('created')
            resolution_date = issue.get('fields', {}).get('resolutiondate')
            status = issue.get('fields', {}).get('status', {}).get('name', 'Unknown')
            updated_date = issue.get('fields', {}).get('updated')
            summary = issue.get('fields', {}).get('summary', 'No summary')
            
            # Track all status names
            all_status_names.add(status)
            
            logger.debug(f"Analyzing issue {issue_key} ({summary}) with status {status}")
            
            # Check the current status category
            current_status_category = 'other'
            for category, status_list in status_categories.items():
                # Try exact match first, then case-insensitive contains
                if status in status_list:
                    current_status_category = category
                    status_category_map[status] = category
                    logger.debug(f"Exact status match: '{status}' -> {category}")
                    break
                elif any(s.lower() in status.lower() for s in status_list):
                    current_status_category = category
                    status_category_map[status] = category
                    logger.debug(f"Fuzzy status match: '{status}' -> {category}")
                    break
                    
            # Count current statuses
            current_status_counts[current_status_category] += 1
            logger.debug(f"Issue {issue_key} counted in category: {current_status_category}")
            
            # Check if ticket is completed
            is_done_status = current_status_category == 'done'
            has_resolution = resolution_date is not None
            
            if is_done_status or has_resolution:
                completed_issues += 1
            elif current_status_category != 'to_do':
                in_progress_issues += 1
                
            # If no resolution date but status is Done, use the updated date
            if not resolution_date and is_done_status and updated_date:
                resolution_date = updated_date
                logger.debug(f"Issue {issue_key} has no resolution date but is in Done status, using updated date: {updated_date}")
            
            # Process status changes to track transitions - for ALL tickets
            status_changes = []
            
            # Extract all status changes from changelog
            for history in changelog:
                for item in history.get('items', []):
                    if item.get('field') == 'status':
                        status_name = item.get('toString')
                        from_status = item.get('fromString', 'Unknown')
                        all_status_names.add(status_name)
                        all_status_names.add(from_status)
                        status_changes.append({
                            'status': status_name,
                            'date': history.get('created')
                        })
            
            # If we have status changes, the first entry in changelog provides the initial status
            initial_status_found = False
            if changelog and len(changelog) > 0:
                for item in changelog[0].get('items', []):
                    if item.get('field') == 'status':
                        initial_status = item.get('fromString')
                        if initial_status and created_date:
                            status_changes.append({
                                'status': initial_status,
                                'date': created_date
                            })
                            initial_status_found = True
                            logger.debug(f"Found initial status for {issue_key}: {initial_status}")
                            break
            
            # If we couldn't find the initial status from changelog, use the current status
            # (but only if this is the only status we know about)
            if not initial_status_found and not status_changes and created_date:
                logger.debug(f"No status history found for {issue_key}, using current status as initial: {current_status}")
                status_changes.append({
                    'status': current_status,
                    'date': created_date
                })
            
            # Add resolution as final status change if not already in changelog
            done_status = "DONE"  # Use exact done status name
            if resolution_date:
                if not status_changes or status_changes[-1]['date'] != resolution_date:
                    status_changes.append({
                        'status': done_status,
                        'date': resolution_date
                    })
            
            # Sort status changes by date
            status_changes.sort(key=lambda x: x['date'])
            
            logger.debug(f"Status changes for {issue_key}: {len(status_changes)} changes")
            
            # Calculate duration in each status
            status_durations = {}
            
            for i in range(len(status_changes)):
                # Current change
                change = status_changes[i]
                status = change['status']
                
                # Start time is this change
                start_time = datetime.fromisoformat(change['date'].replace('Z', '+00:00'))
                
                # End time is next change or current time
                if i < len(status_changes) - 1:
                    # Next status change
                    next_change = status_changes[i + 1]
                    end_time = datetime.fromisoformat(next_change['date'].replace('Z', '+00:00'))
                else:
                    # Current time if this is the latest status
                    end_time = datetime.now(timezone.utc)
                
                # Calculate duration in seconds
                duration_seconds = (end_time - start_time).total_seconds()
                
                # Convert to hours for easier reading
                duration_hours = duration_seconds / 3600
                
                # Add to status durations
                if status in status_durations:
                    status_durations[status] += duration_hours
                else:
                    status_durations[status] = duration_hours
            
            # Find first occurrence of each status category
            first_occurrence = {}
            
            # Track status category sequence for ping-pong detection
            status_category_sequence = []
            previous_category = None
            ticket_ping_pong_score = 0     # Per-ticket ping-pong score
            ticket_ping_pongs = {          # Count of each type of ping-pong for this ticket
                'in_progress_to_to_do': 0,
                'in_review_to_in_progress': 0,
                'in_qa_to_in_review': 0,
                'in_qa_to_in_progress': 0,
                'done_to_any': 0
            }
            ticket_transitions = []        # List of all status transitions for this ticket
            
            for i, change in enumerate(status_changes):
                status = change['status']
                date = change['date']
                
                # Categorize the status - try exact match first, then fuzzy match
                matched = False
                current_category = None
                
                for category, status_list in status_categories.items():
                    if status in status_list:
                        if category not in first_occurrence:
                            first_occurrence[category] = date
                            logger.debug(f"First occurrence of {category} at {date} (exact match: {status})")
                        status_category_map[status] = category
                        current_category = category
                        matched = True
                        break
                
                # If no exact match, try fuzzy match
                if not matched:
                    for category, status_list in status_categories.items():
                        if any(s.lower() in status.lower() for s in status_list):
                            if category not in first_occurrence:
                                first_occurrence[category] = date
                                logger.debug(f"First occurrence of {category} at {date} (fuzzy match: {status})")
                            status_category_map[status] = category
                            current_category = category
                            break
                
                # If we couldn't categorize the status, continue to the next change
                if current_category is None:
                    continue
                    
                # Add to sequence and detect ping-pongs
                if previous_category is not None and current_category != previous_category:
                    # Record the transition
                    ticket_transitions.append({
                        'from': previous_category,
                        'to': current_category,
                        'date': date
                    })
                    
                    # Check if this is a backward transition (ping-pong)
                    # Skip the first status change since we want to ignore initial status
                    if i > 0:
                        if current_category == 'to_do' and previous_category == 'in_progress':
                            # Back to backlog from development
                            ping_pong_metrics['ping_pong_details']['in_progress_to_to_do'] += 1
                            ticket_ping_pongs['in_progress_to_to_do'] += 1
                            ticket_ping_pong_score += 1  # Simple count instead of weight
                            logger.debug(f"Issue {issue_key}: Ping-pong detected - returned to backlog from development")
                            
                        elif current_category == 'in_progress' and previous_category == 'in_review':
                            # Back to development from review
                            ping_pong_metrics['ping_pong_details']['in_review_to_in_progress'] += 1
                            ticket_ping_pongs['in_review_to_in_progress'] += 1
                            ticket_ping_pong_score += 1  # Simple count instead of weight
                            logger.debug(f"Issue {issue_key}: Ping-pong detected - returned to development from review")
                            
                        elif current_category == 'in_review' and previous_category == 'in_qa':
                            # Failed QA, back to review
                            ping_pong_metrics['ping_pong_details']['in_qa_to_in_review'] += 1
                            ticket_ping_pongs['in_qa_to_in_review'] += 1
                            ticket_ping_pong_score += 1  # Simple count instead of weight
                            logger.debug(f"Issue {issue_key}: Ping-pong detected - failed QA, returned to review")
                            
                        elif current_category == 'in_progress' and previous_category == 'in_qa':
                            # Failed QA badly, back to development
                            ping_pong_metrics['ping_pong_details']['in_qa_to_in_progress'] += 1
                            ticket_ping_pongs['in_qa_to_in_progress'] += 1
                            ticket_ping_pong_score += 1  # Simple count instead of weight
                            logger.debug(f"Issue {issue_key}: Ping-pong detected - failed QA, returned to development")
                            
                        elif previous_category == 'done':
                            # Reopened ticket
                            ping_pong_metrics['ping_pong_details']['done_to_any'] += 1
                            ticket_ping_pongs['done_to_any'] += 1
                            ticket_ping_pong_score += 1  # Simple count instead of weight
                            logger.debug(f"Issue {issue_key}: Ping-pong detected - reopened ticket from done state")
                
                # Update previous category for next iteration
                previous_category = current_category
            
            # Save the ticket's ping-pong score
            if ticket_ping_pong_score > 0:
                ping_pong_metrics['tickets_with_ping_pongs'] += 1
                ping_pong_metrics['total_ping_pongs'] += sum(ticket_ping_pongs.values())
                ping_pong_metrics['tickets_with_scores'][issue_key] = {
                    'score': ticket_ping_pong_score,
                    'ping_pongs': ticket_ping_pongs,
                    'transitions': ticket_transitions
                }
                
                # Count ticket in the appropriate score range bucket
                if ticket_ping_pong_score <= 5:
                    ping_pong_metrics['tickets_by_score']['1-5'] += 1
                elif ticket_ping_pong_score <= 10:
                    ping_pong_metrics['tickets_by_score']['6-10'] += 1
                elif ticket_ping_pong_score <= 20:
                    ping_pong_metrics['tickets_by_score']['11-20'] += 1
                else:
                    ping_pong_metrics['tickets_by_score']['21+'] += 1
                
                logger.debug(f"Issue {issue_key} had ping-pongs, incrementing ticket count")
                logger.debug(f"Issue {issue_key} ping-pong score: {ticket_ping_pong_score}")
            
            # Calculate cycle times between key transitions for completed tickets
            if is_done_status or has_resolution:
                # Calculate total time from first TO DO to DONE (not from creation)
                if 'to_do' in first_occurrence and 'done' in first_occurrence:
                    start_time = datetime.fromisoformat(first_occurrence['to_do'].replace('Z', '+00:00'))
                    end_time = datetime.fromisoformat(first_occurrence['done'].replace('Z', '+00:00'))
                    total_hours = (end_time - start_time).total_seconds() / 3600
                    
                    # Only count positive time differences
                    if end_time > start_time:
                        cycle_times['Total']['total_hours'] += total_hours
                        cycle_times['Total']['count'] += 1
                        logger.debug(f"Issue {issue_key}: Total cycle time (To Do → Done): {total_hours:.2f} hours")
                    else:
                        logger.warning(f"Issue {issue_key}: Negative duration for Total cycle (To Do → Done)")
            
            # Track transitions for all tickets (both completed and in-progress)
            transitions = [
                ('to_do', 'in_progress', 'Development'),
                ('in_progress', 'in_review', 'Review'),
                ('in_review', 'in_qa', 'QA'),
                ('in_qa', 'done', 'Completion')
            ]
            
            for start_cat, end_cat, cycle_name in transitions:
                # Count partial transitions for in-progress tickets
                if start_cat in first_occurrence and not (is_done_status or has_resolution):
                    # If ticket has started this transition but not completed it
                    if end_cat not in first_occurrence and current_status_category == start_cat:
                        partial_transitions[cycle_name] += 1
                        logger.debug(f"Issue {issue_key} counted as partial transition for {cycle_name} (in {start_cat}, waiting for {end_cat})")
                
                # Calculate completed transition times
                if start_cat in first_occurrence and end_cat in first_occurrence:
                    start_time = datetime.fromisoformat(first_occurrence[start_cat].replace('Z', '+00:00'))
                    end_time = datetime.fromisoformat(first_occurrence[end_cat].replace('Z', '+00:00'))
                    
                    # Only count positive time differences
                    if end_time > start_time:
                        duration_hours = (end_time - start_time).total_seconds() / 3600
                        cycle_times[cycle_name]['total_hours'] += duration_hours
                        cycle_times[cycle_name]['count'] += 1
                        logger.debug(f"Issue {issue_key}: Added {duration_hours:.2f} hours to '{cycle_name}' cycle (from {start_cat} to {end_cat})")
                    else:
                        logger.warning(f"Issue {issue_key}: Negative or zero duration for {cycle_name} cycle (from {start_cat} at {first_occurrence[start_cat]} to {end_cat} at {first_occurrence[end_cat]})")
        
        # Build a mapping of statuses found but not categorized
        uncategorized_statuses = [status for status in all_status_names if status not in status_category_map]
        
        # Log all workflow steps found
        logger.info(f"All status names found: {sorted(list(all_status_names))}")
        logger.info(f"Status category mapping: {status_category_map}")
        logger.info(f"Uncategorized statuses: {uncategorized_statuses}")
        
        # Calculate averages
        metrics = {
            'total_issues': total_issues,
            'completed_issues': completed_issues,
            'in_progress_issues': in_progress_issues,
            'current_status': current_status_counts,
            'partial_transitions': partial_transitions,
            'cycle_times': {},
            'workflow_info': {
                'all_statuses': sorted(list(all_status_names)),
                'uncategorized_statuses': uncategorized_statuses,
                'status_mapping': status_category_map
            },
            'ping_pong_metrics': ping_pong_metrics
        }
        
        for cycle, data in cycle_times.items():
            if data['count'] > 0:
                avg_hours = data['total_hours'] / data['count']
                metrics['cycle_times'][cycle] = {
                    'average_hours': round(avg_hours, 2),
                    'count': data['count'],
                    'total_hours': round(data['total_hours'], 2),
                    'description': data['description']
                }
            else:
                metrics['cycle_times'][cycle] = {
                    'average_hours': 0,
                    'count': 0,
                    'total_hours': 0,
                    'description': data['description']
                }
                
        logger.debug(f"Calculated cycle time metrics: {metrics}")
        
        return jsonify(metrics), 200
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error fetching issues: {str(e)}")
        return jsonify({'error': f'Request failed: {str(e)}'}), 500
    except Exception as e:
        logger.error(f"Unexpected error in get_resolution_metrics: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500

@app.route('/proxy/boards', methods=['GET'])
def get_boards():
    """Get all available boards/projects from Jira"""
    try:
        # Use backend credentials
        jira_url = JIRA_CREDENTIALS['jira_url']
        email = JIRA_CREDENTIALS['email']
        api_token = JIRA_CREDENTIALS['api_token']
        
        logger.debug(f"Fetching boards using URL: {jira_url}")
        
        if not email or not api_token:
            logger.error("Jira credentials not configured in backend")
            return jsonify({'error': 'Jira credentials not configured in backend'}), 500
            
        # Create auth header
        auth_header = f"Basic {base64.b64encode(f'{email}:{api_token}'.encode()).decode()}"
        
        # Prepare headers for Jira
        jira_headers = {
            'Authorization': auth_header,
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        }
        logger.debug(f"Using headers: {jira_headers}")

        # Fetch all boards with pagination
        all_boards = []
        start_at = 0
        max_results = 50
        total = None
        
        while total is None or start_at < total:
            # Fetch a page of boards
            boards_url = f"{jira_url}/rest/agile/1.0/board?maxResults={max_results}&startAt={start_at}"
            logger.debug(f"Fetching boards page from: {boards_url}")
            
            boards_response = requests.get(boards_url, headers=jira_headers)
            
            if boards_response.status_code >= 400:
                logger.error(f"Error fetching boards: {boards_response.status_code} - {boards_response.text}")
                return jsonify({'error': f'Failed to fetch boards: {boards_response.status_code}'}), boards_response.status_code
                
            boards_data = boards_response.json()
            
            # Update pagination info
            if total is None:
                total = boards_data.get('total', 0)
                logger.debug(f"Total boards available: {total}")
            
            # Add boards from this page
            page_boards = boards_data.get('values', [])
            all_boards.extend(page_boards)
            logger.debug(f"Fetched {len(page_boards)} boards (total so far: {len(all_boards)})")
            
            # Move to next page
            start_at += max_results
            
            # Break if no more boards or we've fetched all
            if not page_boards or len(all_boards) >= total:
                break
        
        logger.debug(f"Found {len(all_boards)} boards total")
        
        # Extract and format board information
        formatted_boards = []
        
        for board in all_boards:
            board_info = {
                'id': board.get('id'),
                'name': board.get('name'),
                'type': board.get('type'),
                'location': {}
            }
            
            # Add project key if available
            location = board.get('location', {})
            if location:
                project_key = location.get('projectKey')
                project_name = location.get('name')
                
                if project_key:
                    board_info['location']['projectKey'] = project_key
                    
                if project_name:
                    board_info['location']['name'] = project_name
            
            formatted_boards.append(board_info)
        
        # Sort boards by name (case-insensitive)
        formatted_boards.sort(key=lambda x: x['name'].lower())
        logger.debug(f"Returning {len(formatted_boards)} formatted boards")
        
        result = {'boards': formatted_boards}
        return jsonify(result), 200
        
    except requests.exceptions.RequestException as e:
        logger.error(f"Request error fetching boards: {str(e)}")
        return jsonify({'error': f'Request failed: {str(e)}'}), 500
    except Exception as e:
        logger.error(f"Unexpected error in get_boards: {str(e)}")
        import traceback
        logger.error(traceback.format_exc())
        return jsonify({'error': f'Unexpected error: {str(e)}'}), 500

@app.errorhandler(Exception)
def handle_error(error):
    """Global error handler to provide more detailed error information"""
    logger.error(f"Unhandled exception: {str(error)}")
    import traceback
    logger.error(traceback.format_exc())
    
    response = {
        'error': str(error),
        'type': error.__class__.__name__
    }
    
    if app.debug:
        response['traceback'] = traceback.format_exc().split('\n')
    
    return jsonify(response), 500

if __name__ == '__main__':
    # Log the configured aging thresholds
    logger.info("Starting server with the following aging thresholds:")
    for status, hours in AGING_THRESHOLDS.items():
        days = round(hours / 24, 1)
        logger.info(f"  - {status}: {hours} hours ({days} days)")
    
    app.run(port=5000, debug=True) 