from flask import Flask, request, jsonify
import requests
from flask_cors import CORS
import base64
import logging
import os
import json
from datetime import datetime, timezone, timedelta

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
        
        # Get optional filtering parameters
        exclude_weekends = request.args.get('excludeWeekends', 'true').lower() == 'true'
        min_time_threshold = float(request.args.get('minTimeThreshold', '0.167'))  # Default to 10 minutes (0.167 hours)
        
        # If board is specified, add it to the JQL query
        if board:
            logger.debug(f"Filtering by board/project: {board}")
            if 'ORDER BY' in jql:
                order_part = jql.split('ORDER BY')
                jql = f"project = {board} AND ({order_part[0].strip()}) ORDER BY {order_part[1].strip()}"
            else:
                jql = f"project = {board} AND ({jql})"
                
        logger.debug(f"Using JQL query for metrics: {jql}")
        logger.debug(f"Configuration: exclude_weekends={exclude_weekends}, min_time_threshold={min_time_threshold}")
            
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
        
        # Define workflow stages to track (meaningful states)
        workflow_stages = {
            'To Do': ['TO DO', 'To Do', 'Backlog', 'Open', 'New', 'Product Backlog'],
            'In Progress': ['IN PROGRESS', 'In Progress', 'Development', 'Implementing', 'Dev', 'Coding'],
            'Code Review': ['IN REVIEW', 'In Review', 'Code Review', 'Review', 'Reviewing', 'PR Review', 'Ready for Review'],
            'QA': ['IN QA', 'In QA', 'QA', 'Testing', 'Validation', 'Test'],
            'Done': ['DONE', 'Done', 'Closed', 'Resolved', 'Completed', 'Fixed']
        }

        # Helper function to exclude weekends if needed
        def calculate_working_hours(start_time, end_time):
            """Calculate working hours between two datetime objects, optionally excluding weekends"""
            if not exclude_weekends:
                # Simple calculation if we don't need to exclude weekends
                return (end_time - start_time).total_seconds() / 3600
                
            # More efficient calculation to exclude weekends
            total_seconds = 0
            
            # Calculate whole days first
            current_date = start_time.replace(hour=0, minute=0, second=0, microsecond=0)
            end_date = end_time.replace(hour=0, minute=0, second=0, microsecond=0)
            
            # Add partial day at the beginning
            if start_time.weekday() < 5:  # Weekday (0-4 is Monday to Friday)
                # Add hours from start time until end of day
                seconds_in_first_day = (current_date + timedelta(days=1) - start_time).total_seconds()
                total_seconds += seconds_in_first_day
            
            # Add whole days in between
            current_date += timedelta(days=1)
            while current_date < end_date:
                if current_date.weekday() < 5:  # Weekday
                    total_seconds += 24 * 3600  # Add full day in seconds
                current_date += timedelta(days=1)
            
            # Add partial day at the end
            if end_time.weekday() < 5:  # Weekday
                # Add hours from start of day until end time
                seconds_in_last_day = (end_time - end_date).total_seconds()
                total_seconds += seconds_in_last_day
            
            return total_seconds / 3600
        
        # Track all status names encountered
        all_status_names = set()
        status_stage_map = {}  # Maps actual status names to our stages

        # Track time spent in each stage by each issue
        stage_data = {stage: {
            'durations': [],                   # All periods in this stage
            'open_durations': [],              # Currently open periods
            'closed_durations': [],            # Closed periods
            'tickets': set(),                  # Unique tickets that entered this stage
            'open_tickets': set(),             # Tickets currently in this stage
            'closed_tickets': set(),           # Tickets that were in this stage but have moved on
            'total_hours': 0,                  # Total hours across all durations
            'open_hours': 0,                   # Hours in currently open periods
            'closed_hours': 0,                 # Hours in closed periods
        } for stage in workflow_stages.keys()}
        
        # Track current status distribution 
        current_status_counts = {stage: 0 for stage in workflow_stages.keys()}
        current_status_counts['Other'] = 0
        
        # Track churn metrics
        churn_metrics = {
            'total_churn': 0,                   # Total number of backward transitions
            'tickets_with_churn': 0,            # Number of tickets with any backward transitions
            'churn_details': {                  # Counts of different types of backward transitions
                'in_progress_to_to_do': 0,
                'in_review_to_in_progress': 0,
                'in_qa_to_in_review': 0,
                'in_qa_to_in_progress': 0,
                'done_to_any': 0
            },
            'tickets_by_score': {               # Tickets grouped by churn score range
                '1-5': 0,
                '6-10': 0,
                '11-20': 0,
                '21+': 0
            },
            'tickets_with_scores': {}           # Dictionary of ticket keys to their churn scores
        }
        
        # Keep track of workflow stage order for churn detection
        workflow_order = {
            'To Do': 1,
            'In Progress': 2,
            'Code Review': 3,
            'QA': 4,
            'Done': 5
        }

        # Current timestamp for calculating open durations
        now = datetime.now(timezone.utc)

        # Analyze each issue
        for issue in issues:
            issue_key = issue.get('key')
            changelog = issue.get('changelog', {}).get('histories', [])
            created_date = issue.get('fields', {}).get('created')
            resolution_date = issue.get('fields', {}).get('resolutiondate')
            current_status_name = issue.get('fields', {}).get('status', {}).get('name', 'Unknown')
            updated_date = issue.get('fields', {}).get('updated')
            
            # Track all status names
            all_status_names.add(current_status_name)
            
            # Find current workflow stage
            current_stage = None
            for stage, status_list in workflow_stages.items():
                if current_status_name in status_list or any(s.lower() in current_status_name.lower() for s in status_list):
                    current_stage = stage
                    status_stage_map[current_status_name] = stage
                    break
            
            # Update current status counts (only if recognized)
            if current_stage:
                current_status_counts[current_stage] += 1
            else:
                # Map uncategorized current statuses to 'Other'
                if current_status_name not in status_stage_map:
                   status_stage_map[current_status_name] = 'Other' 
                current_status_counts['Other'] += 1
            
            # Process status changes to collect all transitions and calculate churn
            all_issue_status_changes = [] # Store all status changes chronologically
            status_transitions_for_churn = [] # Store stage transitions for churn calculation
            issue_churn_count = 0

            for history in changelog:
                history_date = history.get('created')
                for item in history.get('items', []):
                    if item.get('field') == 'status':
                        from_status = item.get('fromString')
                        to_status = item.get('toString')
                        
                        # Add to chronological list
                        all_issue_status_changes.append({
                            'date': history_date,
                            'from': from_status,
                            'to': to_status
                        })
                        
                        # Track the status names
                        all_status_names.add(from_status)
                        all_status_names.add(to_status)
                        
                        # Map statuses to workflow stages for churn detection
                        from_stage = status_stage_map.get(from_status)
                        to_stage = status_stage_map.get(to_status)
                        
                        if not from_stage:
                           for stage, status_list in workflow_stages.items():
                               if from_status in status_list or any(s.lower() in from_status.lower() for s in status_list):
                                   from_stage = stage
                                   status_stage_map[from_status] = stage
                                   break
                           if not from_stage: # Still not found
                               from_stage = 'Other'
                               status_stage_map[from_status] = 'Other'

                        if not to_stage:
                           for stage, status_list in workflow_stages.items():
                               if to_status in status_list or any(s.lower() in to_status.lower() for s in status_list):
                                   to_stage = stage
                                   status_stage_map[to_status] = stage
                                   break
                           if not to_stage: # Still not found
                               to_stage = 'Other'
                               status_stage_map[to_status] = 'Other'

                        # Add to churn transition list
                        status_transitions_for_churn.append({
                            'from_stage': from_stage,
                            'to_stage': to_stage,
                            'date': history_date
                        })
                            
                        # Detect churn (backward workflow transitions, ignoring 'Other' and same-stage)
                        if from_stage != to_stage and from_stage != 'Other' and to_stage != 'Other' and workflow_order.get(to_stage, 0) < workflow_order.get(from_stage, 0):
                            issue_churn_count += 1 
                            # This is a backward transition (churn)
                            if from_stage == 'In Progress' and to_stage == 'To Do':
                                churn_metrics['churn_details']['in_progress_to_to_do'] += 1
                            elif from_stage == 'Code Review' and to_stage == 'In Progress':
                                churn_metrics['churn_details']['in_review_to_in_progress'] += 1
                            elif from_stage == 'QA' and to_stage == 'Code Review':
                                churn_metrics['churn_details']['in_qa_to_in_review'] += 1
                            elif from_stage == 'QA' and to_stage == 'In Progress':
                                churn_metrics['churn_details']['in_qa_to_in_progress'] += 1
                            elif from_stage == 'Done':
                                churn_metrics['churn_details']['done_to_any'] += 1
            
            # Sort all status changes by date
            all_issue_status_changes.sort(key=lambda x: x['date'])

            # Reconstruct the stage history for calculating durations
            status_history = []
            
            # Determine initial status and stage
            initial_status = None
            initial_stage = None

            if not all_issue_status_changes:
                # No status changes recorded, use the current status as the initial one
                initial_status = current_status_name
                initial_stage = status_stage_map.get(initial_status, 'Other')
                logger.debug(f"Issue {issue_key} has no status changes in changelog. Using current status '{initial_status}' ({initial_stage}) as initial.")
            else:
                # Use the 'from' status of the first recorded change
                initial_status = all_issue_status_changes[0].get('from')
                if initial_status:
                    initial_stage = status_stage_map.get(initial_status)
                    if not initial_stage: # Map if not already mapped
                       for stage, status_list in workflow_stages.items():
                           if initial_status in status_list or any(s.lower() in initial_status.lower() for s in status_list):
                               initial_stage = stage
                               status_stage_map[initial_status] = stage
                               break
                       if not initial_stage: # Still not found
                           initial_stage = 'Other'
                           status_stage_map[initial_status] = 'Other'
                    logger.debug(f"Determined initial status for {issue_key} as '{initial_status}' ({initial_stage}) from first changelog entry.")
                else:
                    # Fallback if first 'from' is None (should be rare)
                    initial_status = "Unknown Initial"
                    initial_stage = "Other"
                    logger.warning(f"Could not determine initial status for {issue_key} from first changelog entry (from=None). Defaulting to 'Unknown Initial'.")

            # Add the initial state at creation time
            if created_date and initial_stage:
                status_history.append({
                    'stage': initial_stage,
                    'status': initial_status,
                    'date': created_date
                })
            elif not created_date:
                 logger.warning(f"Issue {issue_key} missing creation date. Cannot accurately track time.")
                 continue # Skip issues without creation date


            # Add all subsequent states from the sorted changes
            for change in all_issue_status_changes:
                to_status = change.get('to')
                to_stage = status_stage_map.get(to_status) # Should be mapped already
                
                if not to_stage: # Should not happen if mapping logic above is correct, but handle defensively
                    logger.warning(f"Status '{to_status}' for issue {issue_key} was not mapped to a stage earlier. Mapping to 'Other'.")
                    to_stage = 'Other'
                    status_stage_map[to_status] = 'Other'
                
                if to_stage: # Only add if we have a stage
                    status_history.append({
                        'stage': to_stage,
                        'status': to_status,
                        'date': change.get('date')
                    })

            # --- The rest of the loop calculates durations based on status_history ---
            # Sort status history by date (redundant if built correctly, but safe)
            # status_history.sort(key=lambda x: x['date']) # Sorting done above

            # Calculate time spent in each stage
            if len(status_history) > 0: # Check if we have at least the initial state
                # Track which stages this issue passed through
                stages_visited = set()
                
                for i in range(len(status_history)):
                    # Current status/stage entry
                    entry = status_history[i]
                    stage = entry['stage']
                    
                    # Skip 'Other' stage for duration calculations
                    if stage == 'Other':
                        logger.debug(f"Skipping duration calculation for 'Other' stage period in {issue_key}")
                        continue 
                        
                    stages_visited.add(stage)
                    
                    # Start time is this entry's date
                    start_time_str = entry['date']
                    if not start_time_str: # Skip if date is missing
                        logger.warning(f"Missing date for history entry in {issue_key}. Skipping duration calculation for this period.")
                        continue
                    start_time = datetime.fromisoformat(start_time_str.replace('Z', '+00:00'))
                    
                    # End time is next entry's date or current time
                    end_time_str = None
                    is_open = False
                    if i < len(status_history) - 1:
                        # Next status entry
                        next_entry = status_history[i + 1]
                        end_time_str = next_entry['date']
                    else:
                        # Current time if this is the latest status
                        end_time = now
                        is_open = True
                    
                    # Parse end time string if it's not the current time
                    if end_time_str:
                         if not end_time_str: # Skip if date is missing
                             logger.warning(f"Missing date for next history entry in {issue_key}. Skipping duration calculation.")
                             continue
                         end_time = datetime.fromisoformat(end_time_str.replace('Z', '+00:00'))

                    # Ensure start_time and end_time are valid
                    if not start_time or not end_time:
                         logger.warning(f"Invalid start or end time for period in {issue_key}. Skipping calculation.")
                         continue
                         
                    # Ensure end_time is after start_time
                    if end_time < start_time:
                        logger.warning(f"End time {end_time} is before start time {start_time} for stage '{stage}' in {issue_key}. Skipping duration calculation for this invalid period.")
                        continue # Skip this invalid period

                    # Calculate duration in hours, potentially excluding weekends
                    duration_hours = calculate_working_hours(start_time, end_time)
                    
                    # Only record if duration is positive and meets minimum threshold
                    if duration_hours >= min_time_threshold:
                        # This issue was in this stage
                        stage_data[stage]['tickets'].add(issue_key)
                        
                        duration_entry = {
                            'issue_key': issue_key,
                            'duration_hours': duration_hours,
                            'start_time': start_time.isoformat(),
                            'end_time': end_time.isoformat(),
                            'is_open': is_open
                        }

                        # Track open vs closed periods
                        if is_open:
                            stage_data[stage]['open_tickets'].add(issue_key)
                            stage_data[stage]['open_durations'].append(duration_entry)
                            stage_data[stage]['open_hours'] += duration_hours
                        else:
                            stage_data[stage]['closed_tickets'].add(issue_key)
                            stage_data[stage]['closed_durations'].append(duration_entry)
                            stage_data[stage]['closed_hours'] += duration_hours
                        
                        # Add to all durations
                        stage_data[stage]['durations'].append(duration_entry)
                        stage_data[stage]['total_hours'] += duration_hours
                
                # Update churn count based on the calculated issue_churn_count
                if issue_churn_count > 0:
                    churn_metrics['tickets_with_churn'] += 1
                    churn_metrics['total_churn'] += issue_churn_count
                    
                    # Track churn score
                    churn_metrics['tickets_with_scores'][issue_key] = {
                        'score': issue_churn_count,
                        'transitions': status_transitions_for_churn # Ensure this list is included
                    }
                    
                    # Count ticket in the appropriate score range bucket
                    if issue_churn_count <= 5:
                        churn_metrics['tickets_by_score']['1-5'] += 1
                    elif issue_churn_count <= 10:
                        churn_metrics['tickets_by_score']['6-10'] += 1
                    elif issue_churn_count <= 20:
                        churn_metrics['tickets_by_score']['11-20'] += 1
                    else:
                        churn_metrics['tickets_by_score']['21+'] += 1
            else: # No valid status history could be built
                logger.warning(f"Could not build valid status history for {issue_key}. Skipping duration calculations.")

        
        # Build a mapping of statuses found but not categorized (excluding 'Other')
        uncategorized_statuses = [status for status, stage in status_stage_map.items() if stage == 'Other' and status != 'Unknown Initial']
        
        # Log all workflow steps found
        logger.info(f"All status names found: {sorted(list(all_status_names))}")
        logger.info(f"Final Status stage mapping: {status_stage_map}")
        logger.info(f"Uncategorized statuses mapped to 'Other': {uncategorized_statuses}")
        
        # Calculate metrics for each stage (excluding 'Other')
        stage_metrics = {}
        for stage, data in stage_data.items():
            if stage == 'Other': continue # Skip 'Other' stage in final metrics

            # Calculate metrics
            metrics = {
                # Tickets
                'tickets_count': len(data['tickets']),
                'open_tickets_count': len(data['open_tickets']),
                'closed_tickets_count': len(data['closed_tickets']),
                
                # Hours
                'total_hours': round(data['total_hours'], 2),
                'open_hours': round(data['open_hours'], 2),
                'closed_hours': round(data['closed_hours'], 2),
                
                # Averages
                'avg_per_ticket': round(data['total_hours'] / len(data['tickets']), 2) if data['tickets'] else 0,
                'avg_per_closed_ticket': round(data['closed_hours'] / len(data['closed_tickets']), 2) if data['closed_tickets'] else 0,
                'avg_per_open_ticket': round(data['open_hours'] / len(data['open_tickets']), 2) if data['open_tickets'] else 0,
                
                # Occurrences
                'count': len(data['durations']),
                'average_hours': round(data['total_hours'] / len(data['durations']), 2) if data['durations'] else 0,
                
                # Include complete data counts
                'durations_count': len(data['durations']),
                'open_durations_count': len(data['open_durations']),
                'closed_durations_count': len(data['closed_durations'])
            }
            
            stage_metrics[stage] = metrics
        
        # Build the complete metrics object
        metrics = {
            'total_issues': len(issues),
            'current_status': current_status_counts,
            'stage_metrics': stage_metrics,
            'calculation_params': {
                'exclude_weekends': exclude_weekends,
                'min_time_threshold': min_time_threshold
            },
            'workflow_info': {
                'all_statuses': sorted(list(all_status_names)),
                'uncategorized_statuses': uncategorized_statuses,
                'status_mapping': status_stage_map
            },
            'churn_metrics': churn_metrics
        }
        
        logger.debug(f"Calculated cycle time metrics: {metrics}")
        logger.info(f"Stage metrics data structure: {stage_metrics}")
        # Log a sample of the data to check structure
        if stage_metrics:
            sample_stage = next(iter(stage_metrics))
            logger.info(f"Sample stage '{sample_stage}' data: {stage_metrics[sample_stage]}")
        
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