class JiraMetrics {
    constructor() {
        this.jiraUrl = '';
        this.proxyUrl = 'http://localhost:5000';
        this.proxyEndpoint = '/proxy';
        this.selectedBoardId = '';
        this.selectedSprintId = '';
        this.storyPointFieldId = null; // Add this property
        this.sprints = [];
        this.issues = [];
        this.issueData = {}; // Store supplementary issue data like status durations
        this.resolutionMetrics = null; // Store resolution time by phase metrics
        this.sortConfig = {
            column: 'created',
            direction: 'desc'
        };
        this.riskThresholds = {
            'In Progress': 72, // Hours (3 days)
            'In Review': 72, // Hours (3 days)
            'In QA': 72, // Hours (3 days)
            'Code Review': 72, // Hours (3 days)
            'Testing': 72, // Hours (3 days)
            'Ready for Review': 72 // Hours (3 days)
        };
        this.showingAtRiskOnly = false;
        this.showingChurnOnly = false;
        this.churnThreshold = 3; // Minimum number of status changes to consider for ticket churn
        this.filters = {
            highRisk: false,
            stalled: false,
            blocking: false,
            churn: false
        };
        this.initializeEventListeners();
        
        // Always show the board selector
        const boardSelector = document.getElementById('boardSelector');
        if (boardSelector) {
            boardSelector.style.display = 'block';
        }
        
        // Initialize the app (loads configuration and boards)
        this.initializeApp();
    }

    initializeEventListeners() {
        // Set up event listeners for the UI controls
        
        // Connect/refresh button
        document.getElementById('connectBtn').addEventListener('click', () => {
            this.fetchJiraData();
        });
        
        // Ticket refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => {
            this.fetchJiraData();
        });
        
        // Board selection change
        document.getElementById('boardSelect').addEventListener('change', async (e) => {
            // Store the selected board
            this.selectedBoardId = e.target.value;
            
            // If a board is selected, fetch its sprints
            if (this.selectedBoardId) {
                await this.fetchSprintsForBoard(this.selectedBoardId);
            } else {
                // If no board selected, clear the sprint dropdown
                this.populateSprintDropdown([]);
            }
        });
        
        // Sprint selection change
        document.getElementById('sprintSelect').addEventListener('change', (e) => {
            this.selectedSprintId = e.target.value;
        });
        
        // Refresh metrics button
        document.getElementById('refresh-metrics').addEventListener('click', () => {
            this.fetchResolutionMetrics();
        });
        
        // Table headers for sorting
        const tableHeaders = document.querySelectorAll('th[data-sort]');
        tableHeaders.forEach(header => {
            header.addEventListener('click', () => {
                const column = header.getAttribute('data-sort');
                this.sortTickets(column);
            });
        });
        
        // Modal close button
        document.getElementById('closeModalBtn').addEventListener('click', () => {
            document.getElementById('statusModal').style.display = 'none';
        });
        
        // Filter checkboxes
        document.getElementById('atRiskOnlyCheckbox').addEventListener('change', () => {
            this.updateDisplayedTickets();
        });
        
        document.getElementById('pingPongOnlyCheckbox').addEventListener('change', () => {
            this.updateDisplayedTickets();
        });
    }

    async loadConfig() {
        try {
            // Load the Jira URL from backend config
            const response = await fetch(`${this.proxyUrl}/config`);
            if (response.ok) {
                const config = await response.json();
                this.jiraUrl = config.jira_url;
                console.log('Using Jira URL from backend:', this.jiraUrl);
                
                // Update UI to show we're using backend credentials
                document.getElementById('jiraUrl').value = this.jiraUrl;
                document.getElementById('email').value = '*** Using backend credentials ***';
                document.getElementById('apiToken').value = '************';
                
                // Read-only inputs
                document.getElementById('jiraUrl').readOnly = true;
                document.getElementById('email').readOnly = true;
                document.getElementById('apiToken').readOnly = true;
                
                // Show a message to select a board
                this.showBoardSelectionMessage();
            }
        } catch (error) {
            console.error('Error loading config:', error);
            this.showError('Failed to load configuration from backend');
        }
    }
    
    showBoardSelectionMessage() {
        const tbody = document.getElementById('ticketTableBody');
        if (tbody) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="7" style="text-align: center; padding: 20px;">
                    Please select a board and click "Apply Filter" to see tickets
                </td>
            `;
            tbody.innerHTML = '';
            tbody.appendChild(emptyRow);
        }
    }

    async fetchSprintsForBoard(board) {
        try {
            const sprintSelect = document.getElementById('sprintSelect');
            const boardSelect = document.getElementById('boardSelect');
            
            if (sprintSelect) {
                // Show loading state
                this.populateSprintDropdown([{ id: '', name: 'Loading sprints...' }]);
                sprintSelect.disabled = true;
            }
            
            if (boardSelect) {
                // Show loading indicator on the board dropdown
                boardSelect.style.cursor = 'wait';
                boardSelect.disabled = true;
            }
            
            const response = await fetch(`${this.proxyUrl}/proxy/board-sprints?board=${encodeURIComponent(board)}`);
            
            if (!response.ok) {
                let errorMsg = `Failed to fetch sprints: ${response.status}`;
                try {
                    const errorData = await response.json();
                    if (errorData && errorData.error) {
                        errorMsg = errorData.error;
                    }
                } catch (parseError) {
                    console.error('Error parsing error response:', parseError);
                }
                throw new Error(errorMsg);
            }
            
            // Parse response data with error handling
            let data;
            try {
                data = await response.json();
            } catch (parseError) {
                console.error('Error parsing sprint data:', parseError);
                throw new Error('Invalid JSON response when fetching sprints');
            }
            
            // Validate sprints data
            if (!data || typeof data !== 'object') {
                console.error('Invalid sprint data received:', data);
                throw new Error('Invalid data format received from server');
            }
            
            this.sprints = Array.isArray(data.sprints) ? data.sprints : [];
            
            // Log detailed information about the sprints
            const boardsChecked = data.boardsChecked || 0;
            const boardsWithSprints = data.boardsWithSprints || 0;
            console.log(`Loaded ${this.sprints.length} sprints for board ${board} (checked ${boardsChecked} boards, found sprints in ${boardsWithSprints})`);
            
            // Preselect the first active sprint if available
            const activeSprintIndex = this.sprints.findIndex(s => s.state === 'active');
            if (activeSprintIndex >= 0) {
                console.log(`Preselecting active sprint: ${this.sprints[activeSprintIndex].name}`);
                this.selectedSprintId = this.sprints[activeSprintIndex].id.toString();
                
                if (sprintSelect && this.selectedSprintId) {
                    sprintSelect.value = this.selectedSprintId;
                }
            }
            
            // Populate the sprint dropdown with the fetched sprints
            const message = this.sprints.length === 0 
                ? 'No sprints found for this board'
                : null;
                
            this.populateSprintDropdown(this.sprints, message);
            
        } catch (error) {
            console.error('Error fetching sprints:', error);
            this.populateSprintDropdown([], `Error: ${error.message}`);
        }
    }
    
    populateSprintDropdown(sprints, message = null) {
        const sprintSelect = document.getElementById('sprintSelect');
        const boardSelect = document.getElementById('boardSelect');
        
        if (!sprintSelect) {
            console.error('Sprint select element not found');
            return;
        }
        
        // Re-enable sprint select
        sprintSelect.disabled = false;
        
        // Re-enable board select if it was disabled
        if (boardSelect) {
            boardSelect.disabled = false;
            boardSelect.style.cursor = 'auto';
        }
        
        // Clear existing options
        sprintSelect.innerHTML = '';
        
        // Build new options
        let options = [
            '<option value="">All sprints</option>'
        ];
        
        // Sort sprints by start date (newest first)
        const sortedSprints = [...sprints].sort((a, b) => {
            if (!a.startDate) return 1;
            if (!b.startDate) return -1;
            return new Date(b.startDate) - new Date(a.startDate);
        });
        
        sortedSprints.forEach(sprint => {
            let name = sprint.name || 'Unnamed Sprint';
            let state = sprint.state ? ` (${sprint.state})` : '';
            let boardInfo = sprint.boardName ? ` - ${sprint.boardName}` : '';
            let selected = sprint.id && this.selectedSprintId === sprint.id.toString() ? 'selected' : '';
            
            options.push(`<option value="${sprint.id}" ${selected}>${name}${state}${boardInfo}</option>`);
        });
        
        // Update the dropdown
        sprintSelect.innerHTML = options.join('');
        
        // If a message was provided, show it as the first option
        if (message) {
            const messageOption = document.createElement('option');
            messageOption.value = '';
            messageOption.textContent = message;
            messageOption.selected = true;
            messageOption.disabled = true;
            sprintSelect.prepend(messageOption);
        }
        
        this.sprints = sprints;
    }

    validateInputs() {
        return this.jiraUrl;
    }

    showError(message) {
        // Create or update error message element
        let errorElement = document.getElementById('error-message');
        if (!errorElement) {
            errorElement = document.createElement('div');
            errorElement.id = 'error-message';
            errorElement.style.color = 'red';
            errorElement.style.marginTop = '10px';
            document.querySelector('.auth-section').appendChild(errorElement);
        }
        errorElement.textContent = message;
    }

    async fetchJiraData() {
        if (!this.validateInputs()) {
            this.showError('Jira URL is required');
            return;
        }

        // Check if board is selected
        if (!this.selectedBoardId) {
            this.showError('Please select a board first');
            this.showBoardSelectionMessage();
            return;
        }
        
        // Show loading indicator
        const refreshBtn = document.getElementById('refreshBtn');
        const originalText = refreshBtn.textContent;
        refreshBtn.innerHTML = '<span class="spinner"></span> Loading...';
        refreshBtn.disabled = true;
        
        // Add spinner style if not already in the document
        if (!document.getElementById('spinnerStyle')) {
            const style = document.createElement('style');
            style.id = 'spinnerStyle';
            style.textContent = `
                .spinner {
                    display: inline-block;
                    width: 12px;
                    height: 12px;
                    border: 2px solid rgba(255,255,255,0.3);
                    border-radius: 50%;
                    border-top-color: white;
                    animation: spin 1s linear infinite;
                    margin-right: 6px;
                }
                @keyframes spin {
                    to { transform: rotate(360deg); }
                }
            `;
            document.head.appendChild(style);
        }
        
        // Reset the issue data store
        this.issueData = {};

        try {
            // First, try to fetch a simple endpoint to test the connection
            const testResponse = await fetch(`${this.proxyUrl}${this.proxyEndpoint}/serverInfo`);

            if (!testResponse.ok) {
                const errorData = await testResponse.json();
                throw new Error(errorData.error || `Jira API returned ${testResponse.status}: ${testResponse.statusText}`);
            }
            
            const testData = await testResponse.json();
            console.log('Successfully connected to Jira:', testData);
            
            // Build the JQL query with filters
            let jqlParts = [];
            
            // Add board/project filter if selected
            if (this.selectedBoardId) {
                jqlParts.push(`project = ${this.selectedBoardId}`);
                console.log('Filtering by board:', this.selectedBoardId);
            }
            
            // Add sprint filter if selected
            if (this.selectedSprintId) {
                jqlParts.push(`sprint = ${this.selectedSprintId}`);
                console.log('Filtering by sprint ID:', this.selectedSprintId);
                
                // Find the sprint name for logging
                const sprint = this.sprints.find(s => s.id.toString() === this.selectedSprintId);
                if (sprint) {
                    console.log('Sprint name:', sprint.name);
                }
            }
            
            // Add sorting
            let jql = jqlParts.length > 0 
                ? jqlParts.join(' AND ') + ' ORDER BY created DESC'
                : 'ORDER BY created DESC';
                
            console.log('Using JQL:', jql);
            
            // Specific fields to request from the API
            const fields = [
                'summary',
                'description',
                'status',
                'priority',
                'created',
                'updated',
                'reporter',
                'assignee',
                'labels',
                'issuelinks'
            ].join(',');
            
            let searchUrl = `${this.proxyUrl}${this.proxyEndpoint}/search?jql=${encodeURIComponent(jql)}&maxResults=100&fields=${encodeURIComponent(fields)}&expand=changelog`;
            console.log('Fetching from URL:', searchUrl);
            
            const response = await fetch(searchUrl);

            if (!response.ok) {
                const errorData = await response.json();
                throw new Error(errorData.error || `Failed to fetch Jira data: ${response.status} ${response.statusText}`);
            }

            const data = await response.json();
            this.issues = data.issues || [];
            
            console.log(`Received ${this.issues.length} issues from Jira API. Here's a sample:`, 
                this.issues.length > 0 ? {key: this.issues[0].key, fields: this.issues[0].fields} : 'No issues found');
            
            // Begin analyzing at-risk tickets
            console.log(`Analyzing ${this.issues.length} tickets for at-risk status`);
            await this.analyzeAtRiskTickets(this.issues);
            
            // After loading issues, fetch resolution metrics
            await this.fetchResolutionMetrics();
            
            // Update the ticket list title based on sprint selection
            const ticketListTitle = document.getElementById('ticketListTitle');
            if (ticketListTitle) {
                if (this.selectedSprintId && this.sprints.length > 0) {
                    const selectedSprint = this.sprints.find(s => s.id.toString() === this.selectedSprintId);
                    ticketListTitle.textContent = selectedSprint ? `Tickets in ${selectedSprint.name}` : 'Tickets for Selected Sprint';
                } else {
                    ticketListTitle.textContent = 'Recent Tickets'; // Default title
                }
            }

            this.updateMetrics(this.issues);
            this.updateTicketTable(this.issues);
        } catch (error) {
            this.showError(`Failed to fetch Jira data: ${error.message}`);
            console.error('Failed to fetch Jira data:', error);
        } finally {
            // Restore button text and enable button
            refreshBtn.innerHTML = originalText;
            refreshBtn.disabled = false;
        }
    }
    
    async fetchResolutionMetrics() {
        console.log('Fetching resolution metrics');
        try {
            // Show loading state
            const loadingElement = document.querySelector('#loading');
            if (loadingElement) {
                loadingElement.classList.remove('hidden');
            }
            
            // Construct JQL for resolved issues to analyze cycle time
            let jql = this.selectedSprintId 
                ? `sprint = ${this.selectedSprintId}` 
                : 'resolved >= -90d';
                
            // Add exclusions if necessary to filter out unwanted issues
            jql += ' ORDER BY key ASC';
            
            // Add board filter if a board is selected
            const boardParam = this.selectedBoardId ? `&board=${this.selectedBoardId}` : '';
            
            // Add optional parameters for the new metrics calculation
            const excludeWeekendsCheckbox = document.querySelector('#exclude-weekends');
            // Default to true if checkbox doesn't exist, otherwise use its value
            const excludeWeekends = excludeWeekendsCheckbox ? excludeWeekendsCheckbox.checked : true;
            const minTimeThreshold = 0.167; // 10 minutes in hours
            
            // Construct final query URL with parameters
            const queryParams = `jql=${encodeURIComponent(jql)}&maxResults=200${boardParam}&excludeWeekends=${excludeWeekends}&minTimeThreshold=${minTimeThreshold}`;
            
            const requestUrl = `${this.proxyUrl}${this.proxyEndpoint}/resolution-metrics?${queryParams}`;
            console.log(`Fetching resolution metrics from: ${requestUrl}`);
            const response = await fetch(requestUrl);
            
            if (!response.ok) {
                const contentType = response.headers.get('content-type');
                if (contentType && contentType.includes('application/json')) {
                    const errorData = await response.json();
                    throw new Error(`Failed to fetch resolution metrics: ${errorData.error || response.statusText}`);
                } else {
                    // Not JSON, probably HTML error page
                    const errorText = await response.text();
                    console.error('Server returned non-JSON response:', errorText.substring(0, 500));
                    throw new Error(`Server error (${response.status}): Not a valid JSON response`);
                }
            }
            
            // Check if response is actually JSON before parsing
            const contentType = response.headers.get('content-type');
            if (!contentType || !contentType.includes('application/json')) {
                const textResponse = await response.text();
                console.error('Expected JSON but got:', textResponse.substring(0, 500));
                throw new Error('Server returned non-JSON response');
            }
            
            this.resolutionMetrics = await response.json();
            
            console.log('Resolution metrics response:', this.resolutionMetrics);
            
            // Render the resolution metrics
            this.renderPhaseResolutionChart();
            
            // Update UI elements that need metrics data
            const metricsElement = document.querySelector('#resolution-metrics');
            if (metricsElement) {
                metricsElement.classList.remove('hidden');
            }
        } catch (error) {
            console.error('Error fetching resolution metrics:', error);
            this.showError(`Error fetching resolution metrics: ${error.message}`);
        } finally {
            const loadingElement = document.querySelector('#loading');
            if (loadingElement) {
                loadingElement.classList.add('hidden');
            }
        }
    }
    
    renderPhaseResolutionChart() {
        // Get the containers
        const chartContainer = document.getElementById('phaseResolutionChart');
        const insightsContainer = document.getElementById('cycleTimeInsights');
        
        if (!chartContainer || !insightsContainer) {
            console.error('Cycle time containers not found');
            return;
        }
        
        // Clear previous content
        chartContainer.innerHTML = '';
        insightsContainer.innerHTML = '';
        
        // Add debug button at the top
        const debugButton = document.createElement('button');
        debugButton.textContent = 'Debug Data';
        debugButton.style.fontSize = '12px';
        debugButton.style.padding = '4px 8px';
        debugButton.style.marginBottom = '10px';
        debugButton.style.backgroundColor = '#f0f0f0';
        debugButton.style.border = '1px solid #ccc';
        debugButton.style.borderRadius = '4px';
        debugButton.style.cursor = 'pointer';
        debugButton.onclick = () => {
            console.log('Debug resolution metrics:', this.resolutionMetrics);
            
            const dataDisplay = document.createElement('pre');
            dataDisplay.style.padding = '10px';
            dataDisplay.style.backgroundColor = '#f5f5f5';
            dataDisplay.style.border = '1px solid #ddd';
            dataDisplay.style.borderRadius = '4px';
            dataDisplay.style.whiteSpace = 'pre-wrap';
            dataDisplay.style.fontSize = '12px';
            dataDisplay.style.maxHeight = '400px';
            dataDisplay.style.overflow = 'auto';
            dataDisplay.textContent = JSON.stringify(this.resolutionMetrics, null, 2);
            
            // Create modal
            const modal = document.createElement('div');
            modal.style.position = 'fixed';
            modal.style.left = '0';
            modal.style.top = '0';
            modal.style.width = '100%';
            modal.style.height = '100%';
            modal.style.backgroundColor = 'rgba(0,0,0,0.5)';
            modal.style.zIndex = '1000';
            modal.style.display = 'flex';
            modal.style.justifyContent = 'center';
            modal.style.alignItems = 'center';
            
            const modalContent = document.createElement('div');
            modalContent.style.backgroundColor = '#fff';
            modalContent.style.padding = '20px';
            modalContent.style.borderRadius = '5px';
            modalContent.style.width = '80%';
            modalContent.style.maxWidth = '800px';
            modalContent.style.maxHeight = '80%';
            modalContent.style.overflow = 'auto';
            
            const closeButton = document.createElement('button');
            closeButton.textContent = 'Close';
            closeButton.style.padding = '5px 10px';
            closeButton.style.marginTop = '10px';
            closeButton.onclick = () => document.body.removeChild(modal);
            
            modalContent.appendChild(document.createTextNode('Raw Resolution Metrics Data:'));
            modalContent.appendChild(document.createElement('br'));
            modalContent.appendChild(dataDisplay);
            modalContent.appendChild(closeButton);
            modal.appendChild(modalContent);
            
            document.body.appendChild(modal);
        };
        chartContainer.appendChild(debugButton);
        
        // Check if we're using the new metrics format or the old format
        if (this.resolutionMetrics && this.resolutionMetrics.stage_metrics) {
            // New format - use stage_metrics
            this.renderStageTimeChart(chartContainer, insightsContainer);
        } else if (this.resolutionMetrics && this.resolutionMetrics.cycle_times) {
            // Old format - use cycle_times
            const cycleTimes = this.resolutionMetrics.cycle_times;
            console.log('Rendering chart with cycle times:', cycleTimes);
            
            // Get the cycle names excluding "Total" (will handle separately)
            const cycleNames = Object.keys(cycleTimes).filter(name => name !== 'Total');
            const cycleHours = cycleNames.map(name => cycleTimes[name].average_hours);
            
            // Calculate maximum value for scaling
            const maxValue = Math.max(...cycleHours, 1); // Ensure we have a non-zero max
            
            // Create the main visualization
            this.renderCycleTimeChart(chartContainer, cycleTimes, cycleNames, maxValue);
            
            // Create the insights panel
            this.renderCycleTimeInsights(insightsContainer, cycleTimes);
            
            // Add workflow diagram if we have cycle data
            if (cycleNames.length > 0 && cycleHours.some(h => h > 0)) {
                this.renderWorkflowDiagram(chartContainer, cycleTimes);
            }
        } else {
            console.warn('No metrics available', this.resolutionMetrics);
            chartContainer.innerHTML = '<p class="no-data">No workflow metrics available. Select a board and load tickets to see analysis.</p>';
        }
    }
    
    renderStageTimeChart(chartContainer, insightsContainer) {
        console.log('renderStageTimeChart called');
        try {
            const stageMetrics = this.resolutionMetrics.stage_metrics;
            console.log('Stage metrics data structure:', stageMetrics);
            
            if (!stageMetrics || Object.keys(stageMetrics).length === 0) {
                console.warn('No stage metrics available or empty object');
                chartContainer.innerHTML = '<p class="no-data">No stage metrics available. This could be because no tickets have transitioned through workflow stages.</p>';
                return;
            }
            
            // Get stage names and sort them in workflow order
            const stageNames = Object.keys(stageMetrics);
            const workflowOrder = {
                'To Do': 1,
                'In Progress': 2,
                'Code Review': 3,
                'QA': 4,
                'Done': 5
            };
            
            stageNames.sort((a, b) => {
                return (workflowOrder[a] || 99) - (workflowOrder[b] || 99);
            });
            
            // Exclude "Done" from the chart as it's typically the end state
            const chartStages = stageNames.filter(name => name !== 'Done');
            
            if (chartStages.length === 0) {
                console.warn('No stages to display after filtering');
                chartContainer.innerHTML = '<p class="no-data">No workflow stages found to display in the chart.</p>';
                return;
            }
            
            // Create chart container with styling
            const chartWrapper = document.createElement('div');
            chartWrapper.style.padding = '25px';
            chartWrapper.style.backgroundColor = '#fff';
            chartWrapper.style.borderRadius = '8px';
            chartWrapper.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)';
            
            // Add title
            const chartTitle = document.createElement('div');
            chartTitle.style.fontWeight = 'bold';
            chartTitle.style.fontSize = '20px';
            chartTitle.style.marginBottom = '15px';
            chartTitle.style.color = '#172B4D';
            chartTitle.textContent = 'Average Time Spent in Each Workflow Stage';
            chartWrapper.appendChild(chartTitle);
            
            // Add description
            const chartDesc = document.createElement('div');
            chartDesc.style.fontSize = '14px';
            chartDesc.style.color = '#666';
            chartDesc.style.marginBottom = '25px';
            
            // Add calculation parameters info
            const calcParams = this.resolutionMetrics.calculation_params || {};
            const excludeWeekends = calcParams.exclude_weekends ? 'excluding weekends' : 'including all days';
            const minThreshold = calcParams.min_time_threshold ? `ignoring periods shorter than ${this.formatDuration(calcParams.min_time_threshold)}` : '';
            
            chartDesc.innerHTML = `Average total time tickets spend in each workflow stage, including any return visits to the same stage (${excludeWeekends}, ${minThreshold}).`;
            chartWrapper.appendChild(chartDesc);
            
            // Create separate sections for averages and open tickets
            const closedSection = document.createElement('div');
            closedSection.style.marginTop = '30px';
            closedSection.style.marginBottom = '40px';
            
            const closedTitle = document.createElement('div');
            closedTitle.style.fontWeight = 'bold';
            closedTitle.style.fontSize = '18px';
            closedTitle.style.marginBottom = '20px';
            closedTitle.textContent = 'Average Time Per Stage (All Tickets)';
            closedSection.appendChild(closedTitle);
            
            // Create bars for each stage - use avg_per_ticket as the primary metric
            const avgHoursPerTicket = chartStages.map(name => stageMetrics[name].avg_per_ticket);
            const maxValue = Math.max(...avgHoursPerTicket, 1);
            
            // Create bars container for average metrics
            const barsContainer = document.createElement('div');
            
            chartStages.forEach((stage, index) => {
                const stageData = stageMetrics[stage];
                const avgHours = stageData.avg_per_ticket;
                const percentage = (avgHours / maxValue) * 100;
                
                // Create row container
                const row = document.createElement('div');
                row.style.display = 'flex';
                row.style.alignItems = 'center';
                row.style.marginBottom = '12px'; // Reduced from 20px
                
                // Create label
                const label = document.createElement('div');
                label.style.width = '160px';
                label.style.paddingRight = '15px';
                label.style.fontWeight = 'bold';
                label.style.fontSize = '14px'; // Reduced from 16px
                label.textContent = stage;
                row.appendChild(label);
                
                // Create bar container
                const barContainer = document.createElement('div');
                barContainer.style.flex = '1';
                barContainer.style.height = '28px'; // Reduced from 38px
                barContainer.style.backgroundColor = '#f0f0f0';
                barContainer.style.borderRadius = '4px'; // Slightly smaller radius
                barContainer.style.position = 'relative';
                barContainer.style.overflow = 'hidden';
                
                // Create the colored bar
                const bar = document.createElement('div');
                bar.style.position = 'absolute';
                bar.style.left = '0';
                bar.style.top = '0';
                bar.style.height = '100%';
                bar.style.width = `${percentage}%`;
                bar.style.backgroundColor = this.getStageColor(stage);
                bar.style.transition = 'width 0.8s ease';
                barContainer.appendChild(bar);
                
                // Create value label
                const valueLabel = document.createElement('div');
                valueLabel.style.position = 'absolute';
                valueLabel.style.right = '10px'; // Adjusted padding
                valueLabel.style.top = '50%';
                valueLabel.style.transform = 'translateY(-50%)';
                valueLabel.style.color = '#000';
                valueLabel.style.fontWeight = 'bold';
                valueLabel.style.fontSize = '14px'; // Reduced from 16px
                valueLabel.style.textShadow = '0 0 3px #fff';
                valueLabel.textContent = this.formatDuration(avgHours);
                barContainer.appendChild(valueLabel);
                
                // Create sample count
                const sampleCount = document.createElement('div');
                sampleCount.style.marginLeft = '15px';
                sampleCount.style.fontSize = '13px'; // Reduced from 14px
                sampleCount.style.color = '#666';
                sampleCount.style.minWidth = '90px';
                sampleCount.textContent = `n=${stageData.tickets_count}`;
                
                // Add additional info about open vs closed
                if (stageData.open_tickets_count > 0) {
                    sampleCount.textContent += ` (${stageData.open_tickets_count} open)`;
                }
                
                row.appendChild(barContainer);
                row.appendChild(sampleCount);
                
                barsContainer.appendChild(row);
            });
            
            closedSection.appendChild(barsContainer);
            chartWrapper.appendChild(closedSection);
            
            // Only add open tickets section if there are any open tickets
            const hasOpenTickets = chartStages.some(stage => stageMetrics[stage].open_tickets_count > 0);
            
            if (hasOpenTickets) {
                // Create separate section for currently open tickets
                const openSection = document.createElement('div');
                openSection.style.marginTop = '30px'; // Reduced from 40px
                
                const openTitle = document.createElement('div');
                openTitle.style.fontWeight = 'bold';
                openTitle.style.fontSize = '16px'; // Reduced from 18px
                openTitle.style.marginBottom = '15px'; // Reduced from 20px
                openTitle.textContent = 'Average Time in Current Stages (Open Tickets Only)';
                openSection.appendChild(openTitle);
                
                // Create bars for open ticket metrics
                const openBarsContainer = document.createElement('div');
                
                // Extract open averages and calculate max
                const openStages = chartStages.filter(stage => stageMetrics[stage].open_tickets_count > 0);
                const openAvgHours = openStages.map(stage => stageMetrics[stage].avg_per_open_ticket);
                const openMaxValue = Math.max(...openAvgHours, 1);
                
                openStages.forEach(stage => {
                    const stageData = stageMetrics[stage];
                    
                    // Skip if no open tickets
                    if (stageData.open_tickets_count === 0) return;
                    
                    const avgOpenHours = stageData.avg_per_open_ticket;
                    const percentage = (avgOpenHours / openMaxValue) * 100;
                    
                    // Create row container
                    const row = document.createElement('div');
                    row.style.display = 'flex';
                    row.style.alignItems = 'center';
                    row.style.marginBottom = '12px'; // Reduced from 20px
                    
                    // Create label
                    const label = document.createElement('div');
                    label.style.width = '160px';
                    label.style.paddingRight = '15px';
                    label.style.fontWeight = 'bold';
                    label.style.fontSize = '14px'; // Reduced from 16px
                    label.textContent = stage;
                    row.appendChild(label);
                    
                    // Create bar container
                    const barContainer = document.createElement('div');
                    barContainer.style.flex = '1';
                    barContainer.style.height = '28px'; // Reduced from 38px
                    barContainer.style.backgroundColor = '#f0f0f0';
                    barContainer.style.borderRadius = '4px'; // Slightly smaller radius
                    barContainer.style.position = 'relative';
                    barContainer.style.overflow = 'hidden';
                    
                    // Create the colored bar
                    const bar = document.createElement('div');
                    bar.style.position = 'absolute';
                    bar.style.left = '0';
                    bar.style.top = '0';
                    bar.style.height = '100%';
                    bar.style.width = `${percentage}%`;
                    bar.style.backgroundColor = this.getStageColor(stage, 0.7); // Use lighter shade
                    bar.style.transition = 'width 0.8s ease';
                    barContainer.appendChild(bar);
                    
                    // Create value label
                    const valueLabel = document.createElement('div');
                    valueLabel.style.position = 'absolute';
                    valueLabel.style.right = '10px'; // Adjusted padding
                    valueLabel.style.top = '50%';
                    valueLabel.style.transform = 'translateY(-50%)';
                    valueLabel.style.color = '#000';
                    valueLabel.style.fontWeight = 'bold';
                    valueLabel.style.fontSize = '14px'; // Reduced from 16px
                    valueLabel.style.textShadow = '0 0 3px #fff';
                    valueLabel.textContent = this.formatDuration(avgOpenHours);
                    barContainer.appendChild(valueLabel);
                    
                    // Create sample count
                    const sampleCount = document.createElement('div');
                    sampleCount.style.marginLeft = '15px';
                    sampleCount.style.fontSize = '13px'; // Reduced from 14px
                    sampleCount.style.color = '#666';
                    sampleCount.style.minWidth = '80px';
                    sampleCount.textContent = `n=${stageData.open_tickets_count}`;
                    
                    row.appendChild(barContainer);
                    row.appendChild(sampleCount);
                    
                    openBarsContainer.appendChild(row);
                });
                
                openSection.appendChild(openBarsContainer);
                chartWrapper.appendChild(openSection);
            }
            
            chartContainer.appendChild(chartWrapper);
            console.log('Chart rendered successfully');
            
            // Generate insights based on stage metrics
            this.renderStageInsights(insightsContainer, stageMetrics);
        } catch (error) {
            console.error('Error rendering stage time chart:', error);
            chartContainer.innerHTML = `<p class="no-data">Error rendering chart: ${error.message}</p>`;
        }
    }
    
    renderStageInsights(container, stageMetrics) {
        const insightsWrapper = document.createElement('div');
        
        // Add title
        const insightsTitle = document.createElement('h3');
        insightsTitle.textContent = 'Workflow Insights & Recommendations';
        insightsTitle.style.fontSize = '16px';
        insightsTitle.style.marginTop = '0';
        insightsWrapper.appendChild(insightsTitle);
        
        // Get stage data for analysis
        const stageNames = Object.keys(stageMetrics).filter(name => name !== 'Done');
        
        if (stageNames.length === 0) {
            const noData = document.createElement('p');
            noData.textContent = 'Not enough data to generate insights.';
            insightsWrapper.appendChild(noData);
            container.appendChild(insightsWrapper);
            return;
        }
        
        // Calculate total development cycle time (sum of all stages except Done)
        let totalCycleHours = 0;
        stageNames.forEach(stage => {
            totalCycleHours += stageMetrics[stage].avg_per_ticket;
        });
        
        // Find the stage with the most time per ticket
        let longestStage = stageNames[0];
        stageNames.forEach(stage => {
            if (stageMetrics[stage].avg_per_ticket > stageMetrics[longestStage].avg_per_ticket) {
                longestStage = stage;
            }
        });
        
        // Find largest open stage if there are open tickets
        let longestOpenStage = null;
        let maxOpenTime = 0;
        
        stageNames.forEach(stage => {
            if (stageMetrics[stage].open_tickets_count > 0 && 
                stageMetrics[stage].avg_per_open_ticket > maxOpenTime) {
                longestOpenStage = stage;
                maxOpenTime = stageMetrics[stage].avg_per_open_ticket;
            }
        });
        
        const insights = [];
        
        // Add insight about the longest stage
        if (stageMetrics[longestStage].avg_per_ticket > 0) {
            const percentage = Math.round((stageMetrics[longestStage].avg_per_ticket / totalCycleHours) * 100);
            insights.push({
                text: `The <strong>${longestStage}</strong> stage takes the longest at ${this.formatDuration(stageMetrics[longestStage].avg_per_ticket)} (${percentage}% of total workflow time).`,
                recommendation: `Consider reviewing the ${longestStage.toLowerCase()} process to identify bottlenecks.`
            });
        }
        
        // Add insight about currently open tickets
        if (longestOpenStage && maxOpenTime > 0) {
            insights.push({
                text: `<strong>${stageMetrics[longestOpenStage].open_tickets_count}</strong> tickets are currently in <strong>${longestOpenStage}</strong> for an average of ${this.formatDuration(maxOpenTime)}.`,
                recommendation: `Consider reviewing these tickets for any that might be stuck or blocked.`
            });
        }
        
        // Add review/QA related insight
        if (stageMetrics['Code Review'] && stageMetrics['Code Review'].avg_per_ticket > 0) {
            const reviewPercentage = Math.round((stageMetrics['Code Review'].avg_per_ticket / totalCycleHours) * 100);
            if (reviewPercentage > 30) {
                insights.push({
                    text: `Code Review takes up ${reviewPercentage}% of the total workflow time.`,
                    recommendation: 'Consider implementing pair programming or more frequent, smaller reviews.'
                });
            }
        }
        
        // Add QA stage insight if present
        if (stageMetrics['QA'] && stageMetrics['QA'].avg_per_ticket > 0) {
            const qaPercentage = Math.round((stageMetrics['QA'].avg_per_ticket / totalCycleHours) * 100);
            if (qaPercentage > 30) {
                insights.push({
                    text: `QA testing takes up ${qaPercentage}% of the total workflow time.`,
                    recommendation: 'Consider implementing more automated testing or earlier testing approaches.'
                });
            }
        }
        
        // Add data validation insight
        const sampleSize = Math.min(...stageNames.map(stage => stageMetrics[stage].tickets_count));
        insights.push({
            text: `This analysis is based on a sample of ${sampleSize} tickets that passed through workflow stages.`,
            recommendation: sampleSize < 10 
                ? 'Consider collecting more data for more reliable insights.'
                : 'The sample size is reasonable for analysis.'
        });
        
        // Create HTML for insights
        const insightsList = document.createElement('div');
        insightsList.style.marginTop = '15px';
        
        insights.forEach(insight => {
            const insightItem = document.createElement('div');
            insightItem.style.marginBottom = '15px';
            insightItem.style.padding = '10px';
            insightItem.style.backgroundColor = '#f5f6f7';
            insightItem.style.borderRadius = '4px';
            insightItem.style.borderLeft = '3px solid #4d90fe';
            
            const insightText = document.createElement('div');
            insightText.style.marginBottom = '5px';
            insightText.innerHTML = insight.text;
            insightItem.appendChild(insightText);
            
            const recommendationText = document.createElement('div');
            recommendationText.style.fontSize = '12px';
            recommendationText.style.color = '#555';
            recommendationText.innerHTML = `<strong>Recommendation:</strong> ${insight.recommendation}`;
            insightItem.appendChild(recommendationText);
            
            insightsList.appendChild(insightItem);
        });
        
        insightsWrapper.appendChild(insightsList);
        container.appendChild(insightsWrapper);
    }
    
    renderCycleTimeChart(container, cycleTimes, cycleNames, maxValue) {
        // Create chart container with styling
        const chartWrapper = document.createElement('div');
        chartWrapper.style.padding = '15px';
        chartWrapper.style.backgroundColor = '#fff';
        chartWrapper.style.borderRadius = '4px';
        chartWrapper.style.boxShadow = 'inset 0 0 5px rgba(0,0,0,0.05)';
        
        // Add title
        const chartTitle = document.createElement('div');
        chartTitle.style.fontWeight = 'bold';
        chartTitle.style.fontSize = '16px';
        chartTitle.style.marginBottom = '5px';
        chartTitle.style.color = '#172B4D';
        chartTitle.textContent = 'Average Cycle Time Between Workflow States';
        chartWrapper.appendChild(chartTitle);
        
        // Show Total Cycle Time prominently
        if (cycleTimes.Total && cycleTimes.Total.average_hours > 0) {
            const totalCycleTime = document.createElement('div');
            totalCycleTime.style.fontSize = '14px';
            totalCycleTime.style.textAlign = 'center';
            totalCycleTime.style.marginBottom = '20px';
            totalCycleTime.style.padding = '10px';
            totalCycleTime.style.backgroundColor = '#f0f7ff';
            totalCycleTime.style.borderRadius = '4px';
            totalCycleTime.innerHTML = `<strong>Average Total Cycle Time:</strong> ${this.formatDuration(cycleTimes.Total.average_hours)} <span style="color:#666; font-size:12px;">(from ticket creation to resolution)</span>`;
            chartWrapper.appendChild(totalCycleTime);
        }
        
        // Create bars for each cycle time
        const barsContainer = document.createElement('div');
        barsContainer.style.marginTop = '15px';
        
        cycleNames.forEach(cycle => {
            const cycleData = cycleTimes[cycle];
            const avgHours = cycleData.average_hours;
            const percentage = (avgHours / maxValue) * 100;
            
            // Create row container
            const row = document.createElement('div');
            row.style.display = 'flex';
            row.style.alignItems = 'center';
            row.style.marginBottom = '15px';
            
            // Create label with description
            const label = document.createElement('div');
            label.style.width = '140px';
            label.style.paddingRight = '10px';
            
            const cycleName = document.createElement('div');
            cycleName.style.fontWeight = 'bold';
            cycleName.textContent = cycle;
            label.appendChild(cycleName);
            
            const cycleDesc = document.createElement('div');
            cycleDesc.style.fontSize = '10px';
            cycleDesc.style.color = '#666';
            cycleDesc.textContent = cycleData.description;
            label.appendChild(cycleDesc);
            
            row.appendChild(label);
            
            // Create bar container
            const barContainer = document.createElement('div');
            barContainer.style.flex = '1';
            barContainer.style.height = '30px';
            barContainer.style.backgroundColor = '#f0f0f0';
            barContainer.style.borderRadius = '4px';
            barContainer.style.position = 'relative';
            barContainer.style.overflow = 'hidden';
            
            // Create the colored bar
            const bar = document.createElement('div');
            bar.style.position = 'absolute';
            bar.style.left = '0';
            bar.style.top = '0';
            bar.style.height = '100%';
            bar.style.width = `${percentage}%`;
            bar.style.backgroundColor = this.getCycleColor(cycle);
            bar.style.transition = 'width 0.5s ease';
            barContainer.appendChild(bar);
            
            // Create value label
            const valueLabel = document.createElement('div');
            valueLabel.style.position = 'absolute';
            valueLabel.style.right = '10px';
            valueLabel.style.top = '50%';
            valueLabel.style.transform = 'translateY(-50%)';
            valueLabel.style.color = '#000';
            valueLabel.style.fontWeight = 'bold';
            valueLabel.style.textShadow = '0 0 2px #fff';
            valueLabel.textContent = this.formatDuration(avgHours);
            barContainer.appendChild(valueLabel);
            
            // Create sample count
            const sampleCount = document.createElement('div');
            sampleCount.style.marginLeft = '10px';
            sampleCount.style.fontSize = '11px';
            sampleCount.style.color = '#666';
            sampleCount.style.minWidth = '50px';
            sampleCount.textContent = `n=${cycleData.count}`;
            
            row.appendChild(barContainer);
            row.appendChild(sampleCount);
            
            barsContainer.appendChild(row);
        });
        
        chartWrapper.appendChild(barsContainer);
        
        // Add the chart to the container
        container.appendChild(chartWrapper);
    }
    
    renderCycleTimeInsights(container, cycleTimes) {
        const insightsWrapper = document.createElement('div');
        
        // Add title
        const insightsTitle = document.createElement('h3');
        insightsTitle.textContent = 'Insights & Recommendations';
        insightsTitle.style.fontSize = '16px';
        insightsTitle.style.marginTop = '0';
        insightsWrapper.appendChild(insightsTitle);
        
        // Get cycle times for analysis
        const cycles = Object.keys(cycleTimes).filter(name => name !== 'Total');
        
        if (cycles.length === 0 || !cycleTimes.Total || cycleTimes.Total.average_hours === 0) {
            const noData = document.createElement('p');
            noData.textContent = 'Not enough data to generate insights.';
            insightsWrapper.appendChild(noData);
            container.appendChild(insightsWrapper);
            return;
        }
        
        // Find the longest cycle
        let longestCycle = cycles[0];
        cycles.forEach(cycle => {
            if (cycleTimes[cycle].average_hours > cycleTimes[longestCycle].average_hours) {
                longestCycle = cycle;
            }
        });
        
        // Calculate percentages of total time
        const totalHours = cycleTimes.Total.average_hours;
        const insights = [];
        
        // Add insight about the longest phase
        if (cycleTimes[longestCycle].average_hours > 0) {
            const percentage = Math.round((cycleTimes[longestCycle].average_hours / totalHours) * 100);
            insights.push({
                text: `The <strong>${longestCycle}</strong> phase takes the longest at ${this.formatDuration(cycleTimes[longestCycle].average_hours)} (${percentage}% of total cycle time).`,
                recommendation: `Consider reviewing the ${longestCycle.toLowerCase()} process to identify bottlenecks.`
            });
        }
        
        // Add insight about review time if applicable
        if (cycleTimes['Review'] && cycleTimes['Review'].average_hours > 0) {
            const reviewPercentage = Math.round((cycleTimes['Review'].average_hours / totalHours) * 100);
            if (reviewPercentage > 30) {
                insights.push({
                    text: `Reviews take up ${reviewPercentage}% of the total cycle time.`,
                    recommendation: 'Consider implementing pair programming or more frequent, smaller reviews.'
                });
            }
        }
        
        // Add insight about QA time if applicable
        if (cycleTimes['QA'] && cycleTimes['QA'].average_hours > 0) {
            const qaPercentage = Math.round((cycleTimes['QA'].average_hours / totalHours) * 100);
            if (qaPercentage > 25) {
                insights.push({
                    text: `QA takes up ${qaPercentage}% of the total cycle time.`,
                    recommendation: 'Consider adding more automated testing to catch issues earlier.'
                });
            }
        }
        
        // Add overall cycle time insight
        insights.push({
            text: `Average total cycle time is ${this.formatDuration(totalHours)}.`,
            recommendation: cycleTimes.Total.count > 10 
                ? 'This is based on a good sample size.'
                : 'More data would improve the reliability of these metrics.'
        });
        
        // Create insights list
        if (insights.length > 0) {
            const insightsList = document.createElement('ul');
            insightsList.style.paddingLeft = '20px';
            
            insights.forEach(insight => {
                const insightItem = document.createElement('li');
                insightItem.style.marginBottom = '12px';
                
                const insightText = document.createElement('div');
                insightText.innerHTML = insight.text;
                insightItem.appendChild(insightText);
                
                if (insight.recommendation) {
                    const recommendation = document.createElement('div');
                    recommendation.style.fontSize = '12px';
                    recommendation.style.color = '#006644';
                    recommendation.style.marginTop = '4px';
                    recommendation.innerHTML = `<strong>Tip:</strong> ${insight.recommendation}`;
                    insightItem.appendChild(recommendation);
                }
                
                insightsList.appendChild(insightItem);
            });
            
            insightsWrapper.appendChild(insightsList);
        }
        
        // Add data source note
        const dataSample = document.createElement('div');
        dataSample.style.fontSize = '12px';
        dataSample.style.color = '#666';
        dataSample.style.marginTop = '15px';
        dataSample.style.padding = '8px';
        dataSample.style.backgroundColor = '#f5f5f5';
        dataSample.style.borderRadius = '4px';
        dataSample.innerHTML = `Based on ${this.resolutionMetrics.total_resolved_issues} resolved issues.<br>Only completed tickets are included in this analysis.`;
        insightsWrapper.appendChild(dataSample);
        
        container.appendChild(insightsWrapper);
    }
    
    renderWorkflowDiagram(container, cycleTimes) {
        // Create workflow diagram to visualize the process
        const workflowWrapper = document.createElement('div');
        workflowWrapper.className = 'workflow-diagram';
        workflowWrapper.style.marginTop = '30px';
        workflowWrapper.style.padding = '20px 10px';
        workflowWrapper.style.borderTop = '1px solid #eee';
        
        // Define workflow stages in sequence
        const stages = [
            { name: 'To Do', color: '#dfe1e6' },
            { name: 'In Progress', cycle: 'Development', color: '#36B37E' },
            { name: 'In Review', cycle: 'Review', color: '#00B8D9' },
            { name: 'In QA', cycle: 'QA', color: '#6554C0' },
            { name: 'Done', cycle: 'Completion', color: '#FF8B00' }
        ];
        
        // Create each stage and connecting arrows
        stages.forEach((stage, index) => {
            // Create the stage element
            const stageEl = document.createElement('div');
            stageEl.className = 'workflow-stage';
            stageEl.style.backgroundColor = stage.color;
            stageEl.style.color = this.getContrastColor(stage.color);
            stageEl.textContent = stage.name;
            
            // Add cycle time if available
            if (stage.cycle && cycleTimes[stage.cycle]) {
                const cycleTime = document.createElement('div');
                cycleTime.style.fontSize = '10px';
                cycleTime.style.marginTop = '3px';
                cycleTime.textContent = this.formatDuration(cycleTimes[stage.cycle].average_hours);
                stageEl.appendChild(cycleTime);
            }
            
            workflowWrapper.appendChild(stageEl);
            
            // Add arrow if not the last stage
            if (index < stages.length - 1) {
                const arrow = document.createElement('div');
                arrow.className = 'workflow-arrow';
                workflowWrapper.appendChild(arrow);
            }
        });
        
        container.appendChild(workflowWrapper);
    }
    
    getContrastColor(hexColor) {
        // Function to determine if text should be black or white based on background
        if (!hexColor.startsWith('#')) {
            return '#000000';
        }
        
        // Extract RGB components
        let r = parseInt(hexColor.substr(1, 2), 16);
        let g = parseInt(hexColor.substr(3, 2), 16);
        let b = parseInt(hexColor.substr(5, 2), 16);
        
        // Calculate brightness (YIQ formula)
        const brightness = (r * 299 + g * 587 + b * 114) / 1000;
        
        // Return black or white based on brightness
        return brightness > 128 ? '#000000' : '#FFFFFF';
    }

    getCycleColor(cycle) {
        const colors = {
            'Development': '#36B37E',  // Green
            'Review': '#00B8D9',       // Cyan
            'QA': '#6554C0',           // Purple
            'Completion': '#FF8B00',   // Orange
            'Total': '#0052CC'         // Blue
        };
        
        return colors[cycle] || '#9E9E9E';
    }

    async analyzeAtRiskTickets(issues) {
        // Get current time for comparison
        const now = new Date();
        
        // Process each issue
        const promises = issues.map(async issue => {
            const currentStatus = issue.fields.status.name;
            
            try {
                // Fetch detailed history for this issue
                const response = await fetch(`${this.proxyUrl}${this.proxyEndpoint}/issue-history/${issue.key}`);
                
                if (!response.ok) {
                    console.error(`Failed to fetch history for ${issue.key}: ${response.status}`);
                    return;
                }
                
                const data = await response.json();
                
                // Store the full data
                this.issueData[issue.key] = data;
                
                // Analyze risk level
                this.analyzeRiskLevel(issue, data, now);
                
                // Analyze ping-pong transitions
                this.analyzePingPongTransitions(issue, data);
                
                // Analyze ticket churn transitions
                this.analyzeChurnTransitions(issue, data);
                
            } catch (error) {
                console.error(`Error analyzing risk for ${issue.key}:`, error);
            }
        });
        
        // Wait for all the analysis to complete
        await Promise.all(promises);
        
        // Count aging tickets
        const atRiskCount = Object.values(this.issueData).filter(data => data.isAging).length;
        const pingPongCount = Object.values(this.issueData).filter(data => data.isPingPong).length;
        const churnCount = Object.values(this.issueData).filter(data => data.isChurn).length;
        console.log(`Analysis complete: Found ${atRiskCount} aging tickets and ${pingPongCount} ticket churn tickets and ${churnCount} ticket churn tickets`);
    }
    
    analyzeRiskLevel(issue, data, now) {
        const currentStatus = issue.fields.status.name;
        
        // Create a mapping of exact Jira status names to our standardized categories
        const statusMapping = {
            'In Progress': 'In Progress',
            'IN PROGRESS': 'In Progress',
            'Development': 'In Progress',
            'Implementing': 'In Progress',
            'Coding': 'In Progress',
            
            'In Review': 'In Review',
            'IN REVIEW': 'In Review',
            'Code Review': 'In Review',
            'PR Review': 'In Review',
            'Reviewing': 'In Review',
            
            'In QA': 'In QA',
            'IN QA': 'In QA',
            'QA': 'In QA',
            'Testing': 'In QA',
            'Validation': 'In QA',
            
            'To Do': 'To Do',
            'TO DO': 'To Do',
            'Backlog': 'To Do',
            'Open': 'To Do',
            'New': 'To Do',
            
            'Done': 'Done',
            'DONE': 'Done',
            'Closed': 'Done',
            'Resolved': 'Done',
            'Completed': 'Done',
            'Fixed': 'Done',
            "Closed - Won't Do": 'Done'
        };
        
        // Check if status matches one of our key categories (In Progress, In Review, In QA)
        let matchedCategory = statusMapping[currentStatus];
        
        // If no exact match, try a case-insensitive partial match
        if (!matchedCategory) {
            for (const [statusName, threshold] of Object.entries(this.riskThresholds)) {
                if (currentStatus.toLowerCase().includes(statusName.toLowerCase())) {
                    matchedCategory = statusName;
                    break;
                }
            }
        }
        
        // Skip if this status isn't one we're monitoring for aging
        if (!matchedCategory) {
            return;
        }
        
        // Skip aging calculation for To Do and Done statuses
        if (matchedCategory === 'To Do' || matchedCategory === 'Done') {
            this.issueData[issue.key] = this.issueData[issue.key] || {};
            this.issueData[issue.key].currentStatusCategory = matchedCategory;
            this.issueData[issue.key].isAging = false;
            this.issueData[issue.key].riskLevel = 'none';
            return;
        }
        
        // Find how long the ticket has been in the current status
        const statusChanges = data.status_changes || [];
        if (statusChanges.length === 0) return;
        
        // Find the last change TO the current status
        const currentStatusChanges = statusChanges.filter(change => 
            change.to === currentStatus
        );
        
        if (currentStatusChanges.length === 0) return;
        
        // Get the most recent status change to the current status
        const lastStatusChange = currentStatusChanges[currentStatusChanges.length - 1];
        const statusChangeDate = new Date(lastStatusChange.date);
        
        // Calculate hours in current status - this is the continuous time since last change to this status
        const hoursInStatus = (now - statusChangeDate) / (1000 * 60 * 60);
        
        // Store this for later use
        this.issueData[issue.key] = this.issueData[issue.key] || {};
        this.issueData[issue.key].hoursInCurrentStatus = hoursInStatus;
        this.issueData[issue.key].currentStatusCategory = matchedCategory;
        
        // Get the appropriate threshold for the matched category - use dynamic threshold
        const threshold = this.riskThresholds[matchedCategory] || 72; // Default to 72 hours if not specified
        
        // Determine risk level based on the dynamic threshold
        let isAging = false;
        let riskLevel = 'none';
        
        if (hoursInStatus >= threshold) {
            // Over threshold = aging ticket
            isAging = true;
            
            if (hoursInStatus >= threshold * 2) {
                // Over 2x threshold = high risk
                riskLevel = 'high';
            } else {
                // Between 1-2x threshold = medium risk
                riskLevel = 'medium';
            }
        }
        
        this.issueData[issue.key].isAging = isAging;
        this.issueData[issue.key].riskLevel = riskLevel;
        this.issueData[issue.key].timeInStatus = this.formatDuration(hoursInStatus);
        
        console.log(`Ticket ${issue.key} in status "${currentStatus}" (category: ${matchedCategory}) for ${this.formatDuration(hoursInStatus)} continuously - Risk Level: ${riskLevel} - Threshold: ${threshold} hours`);
    }
    
    analyzePingPongTransitions(issue, data) {
        // Extract issue key for logging
        const issueKey = issue.key;
        
        // Check if we have ping-pong data from the backend
        if (data.ping_pong_score !== undefined) {
            // Use the backend's ping-pong score
            this.issueData[issueKey] = this.issueData[issueKey] || {};
            this.issueData[issueKey].pingPongScore = data.ping_pong_score;
            this.issueData[issueKey].pingPongTransitions = data.ping_pong_transitions || [];
            this.issueData[issueKey].isPingPong = data.ping_pong_score >= this.pingPongThreshold;
            
            console.log(`Using backend ping-pong score for ${issueKey}: ${data.ping_pong_score}`);
            return;
        }
        
        // No ping-pong data from backend, calculate from status changes
        const statusChanges = data.status_changes || [];
        if (statusChanges.length < 3) {
            // Not enough status changes for ping-pong
            this.issueData[issueKey] = this.issueData[issueKey] || {};
            this.issueData[issueKey].pingPongScore = 0;
            this.issueData[issueKey].isPingPong = false;
            this.issueData[issueKey].statusTransitions = [];
            return;
        }
        
        // Define status categories for transition tracking
        const statusCategories = {
            'to_do': ['TO DO', 'To Do', 'Backlog', 'Open', 'New', 'Product Backlog'],
            'in_progress': ['IN PROGRESS', 'In Progress', 'Development', 'Implementing', 'Dev', 'Coding'],
            'in_review': ['IN REVIEW', 'In Review', 'Code Review', 'Review', 'Reviewing', 'PR Review'],
            'in_qa': ['IN QA', 'In QA', 'QA', 'Testing', 'Validation', 'Test'],
            'done': ['DONE', 'Done', 'Closed', 'Resolved', 'Completed', 'Fixed']
        };
        
        // Track the sequence of status categories
        const categorySequence = [];
        const transitions = [];
        let pingPongScore = 0;
        const pingPongCounts = {
            'in_progress_to_to_do': 0,
            'in_review_to_in_progress': 0,
            'in_qa_to_in_review': 0,
            'in_qa_to_in_progress': 0,
            'done_to_any': 0
        };
        
        // Process each status change
        for (let i = 0; i < statusChanges.length; i++) {
            const change = statusChanges[i];
            const statusName = change.to;
            
            // Determine status category
            let category = null;
            for (const [cat, statuses] of Object.entries(statusCategories)) {
                if (statuses.includes(statusName)) {
                    category = cat;
                    break;
                }
                
                // Try fuzzy match if exact match fails
                if (!category && statuses.some(s => statusName.toLowerCase().includes(s.toLowerCase()))) {
                    category = cat;
                    break;
                }
            }
            
            // Skip if we couldn't categorize
            if (!category) continue;
            
            // Add to sequence
            categorySequence.push({
                category,
                date: change.date
            });
            
            // Can't detect ping-pong until we have at least 2 status changes
            if (categorySequence.length < 2) continue;
            
            // Get previous category
            const previous = categorySequence[categorySequence.length - 2];
            const current = categorySequence[categorySequence.length - 1];
            
            // Record the transition
            transitions.push({
                from: previous.category,
                to: current.category,
                date: current.date
            });
            
            // Skip the first transition (initial status)
            if (i > 0) {
                // Check if this is a backward transition (ping-pong)
                if (current.category === 'to_do' && previous.category === 'in_progress') {
                    // Back to backlog from development
                    pingPongCounts['in_progress_to_to_do']++;
                    pingPongScore += 1;
                    console.log(`Issue ${issueKey}: Ping-pong detected - returned to backlog from development`);
                }
                else if (current.category === 'in_progress' && previous.category === 'in_review') {
                    // Back to development from review
                    pingPongCounts['in_review_to_in_progress']++;
                    pingPongScore += 1;
                    console.log(`Issue ${issueKey}: Ping-pong detected - returned to development from review`);
                }
                else if (current.category === 'in_review' && previous.category === 'in_qa') {
                    // Failed QA, back to review
                    pingPongCounts['in_qa_to_in_review']++;
                    pingPongScore += 1;
                    console.log(`Issue ${issueKey}: Ping-pong detected - failed QA, returned to review`);
                }
                else if (current.category === 'in_progress' && previous.category === 'in_qa') {
                    // Failed QA badly, back to development
                    pingPongCounts['in_qa_to_in_progress']++;
                    pingPongScore += 1;
                    console.log(`Issue ${issueKey}: Ping-pong detected - failed QA, returned to development`);
                }
                else if (previous.category === 'done') {
                    // Reopened ticket
                    pingPongCounts['done_to_any']++;
                    pingPongScore += 1;
                    console.log(`Issue ${issueKey}: Ping-pong detected - reopened ticket from done state`);
                }
            }
        }
        
        // Store the results
        this.issueData[issueKey] = this.issueData[issueKey] || {};
        this.issueData[issueKey].pingPongScore = pingPongScore;
        this.issueData[issueKey].statusTransitions = transitions;
        this.issueData[issueKey].pingPongCounts = pingPongCounts;
        this.issueData[issueKey].isPingPong = pingPongScore >= this.pingPongThreshold;
        
        // Log if it's a ping-pong issue
        if (this.issueData[issueKey].isPingPong) {
            console.log(`Ping-pong ticket ${issueKey} detected! Score: ${pingPongScore}`);
        }
    }
    
    analyzeChurnTransitions(issue, data) {
        // Extract issue key for logging
        const issueKey = issue.key;
        
        // Check if we have ticket churn data from the backend
        if (data.ping_pong_score !== undefined) {
            // Use the backend's ticket churn score
            this.issueData[issueKey] = this.issueData[issueKey] || {};
            this.issueData[issueKey].churnScore = data.ping_pong_score;
            this.issueData[issueKey].churnTransitions = data.ping_pong_transitions || [];
            this.issueData[issueKey].isChurn = data.ping_pong_score >= this.churnThreshold;
            
            console.log(`Using backend ticket churn score for ${issueKey}: ${data.ping_pong_score}`);
            return;
        }
        
        // No ticket churn data from backend, calculate from status changes
        const statusChanges = data.status_changes || [];
        if (statusChanges.length < 3) {
            // Not enough status changes for ticket churn
            this.issueData[issueKey] = this.issueData[issueKey] || {};
            this.issueData[issueKey].churnScore = 0;
            this.issueData[issueKey].isChurn = false;
            this.issueData[issueKey].statusTransitions = [];
            return;
        }
        
        // Define status categories for transition tracking
        const statusCategories = {
            'to_do': ['TO DO', 'To Do', 'Backlog', 'Open', 'New', 'Product Backlog'],
            'in_progress': ['IN PROGRESS', 'In Progress', 'Development', 'Implementing', 'Dev', 'Coding'],
            'in_review': ['IN REVIEW', 'In Review', 'Code Review', 'Review', 'Reviewing', 'PR Review'],
            'in_qa': ['IN QA', 'In QA', 'QA', 'Testing', 'Validation', 'Test'],
            'done': ['DONE', 'Done', 'Closed', 'Resolved', 'Completed', 'Fixed']
        };
        
        // Track the sequence of status categories
        const categorySequence = [];
        const actualChurnTransitions = []; // Array to store only churn-contributing transitions
        let churnScore = 0;
        const churnCounts = {
            'in_progress_to_to_do': 0,
            'in_review_to_in_progress': 0,
            'in_qa_to_in_review': 0,
            'in_qa_to_in_progress': 0,
            'done_to_any': 0
        };
        
        // Process each status change
        for (let i = 0; i < statusChanges.length; i++) {
            const change = statusChanges[i];
            const statusName = change.to;
            
            // Determine status category
            let category = null;
            for (const [cat, statuses] of Object.entries(statusCategories)) {
                if (statuses.includes(statusName)) {
                    category = cat;
                    break;
                }
                
                // Try fuzzy match if exact match fails
                if (!category && statuses.some(s => statusName.toLowerCase().includes(s.toLowerCase()))) {
                    category = cat;
                    break;
                }
            }
            
            // Skip if we couldn't categorize
            if (!category) continue;
            
            // Add to sequence
            categorySequence.push({
                category,
                date: change.date
            });
            
            // Can't detect ticket churn until we have at least 2 status changes
            if (categorySequence.length < 2) continue;
            
            // Get previous category
            const previous = categorySequence[categorySequence.length - 2];
            const current = categorySequence[categorySequence.length - 1];
            
            // Record the transition
            transitions.push({
                from: previous.category,
                to: current.category,
                date: current.date
            });
            
            // Skip the first transition (initial status)
            if (i > 0) {
                let isChurnTransition = false;
                // Check if this is a backward transition (ticket churn)
                if (current.category === 'to_do' && previous.category === 'in_progress') {
                    isChurnTransition = true;
                    churnCounts['in_progress_to_to_do']++;
                    console.log(`Issue ${issueKey}: Ticket churn detected - returned to backlog from development`);
                }
                else if (current.category === 'in_progress' && previous.category === 'in_review') {
                    isChurnTransition = true;
                    churnCounts['in_review_to_in_progress']++;
                    console.log(`Issue ${issueKey}: Ticket churn detected - returned to development from review`);
                }
                else if (current.category === 'in_review' && previous.category === 'in_qa') {
                    isChurnTransition = true;
                    churnCounts['in_qa_to_in_review']++;
                    console.log(`Issue ${issueKey}: Ticket churn detected - failed QA, returned to review`);
                }
                else if (current.category === 'in_progress' && previous.category === 'in_qa') {
                    isChurnTransition = true;
                    churnCounts['in_qa_to_in_progress']++;
                    console.log(`Issue ${issueKey}: Ticket churn detected - failed QA, returned to development`);
                }
                else if (previous.category === 'done') {
                    isChurnTransition = true;
                    churnCounts['done_to_any']++;
                    console.log(`Issue ${issueKey}: Ticket churn detected - reopened ticket from done state`);
                }

                if (isChurnTransition) {
                    churnScore += 1;
                    // Store the actual backward transition that contributed to the score
                    actualChurnTransitions.push({
                        from: previous.category,
                        to: current.category,
                        date: current.date
                    });
                }
            }
        }
        
        // Store the results
        this.issueData[issueKey] = this.issueData[issueKey] || {};
        this.issueData[issueKey].churnScore = churnScore;
        this.issueData[issueKey].statusTransitions = actualChurnTransitions; // Store only actual churn transitions
        this.issueData[issueKey].churnCounts = churnCounts;
        this.issueData[issueKey].isChurn = churnScore >= this.churnThreshold;
        
        // Log if it's a ticket churn issue
        if (this.issueData[issueKey].isChurn) {
            console.log(`Ticket churn ticket ${issueKey} detected! Score: ${churnScore}`);
        }
    }

    updateMetrics(issues) {
        // Remove Total tickets calculation
        // document.getElementById('totalTickets').textContent = issues.length;

        // Remove average resolution time calculation
        /*
        const resolvedIssues = issues.filter(issue => issue.fields.resolutiondate);
        const totalResolutionTime = resolvedIssues.reduce((total, issue) => {
            const created = new Date(issue.fields.created);
            const resolved = new Date(issue.fields.resolutiondate);
            return total + (resolved - created);
        }, 0);

        const avgResolutionTime = resolvedIssues.length > 0 
            ? Math.round(totalResolutionTime / (resolvedIssues.length * 24 * 60 * 60 * 1000))
            : 0;
        document.getElementById('avgResolutionTime').textContent = `${avgResolutionTime} days`;
        */

        // Calculate priority distribution
        const priorityCounts = {};
        issues.forEach(issue => {
            const priority = issue.fields.priority.name;
            priorityCounts[priority] = (priorityCounts[priority] || 0) + 1;
        });
        this.createPriorityChart(priorityCounts);
        
        // Calculate risk distribution
        this.createRiskSummary(issues);
        
        // Render phase resolution chart if metrics are available
        if (this.resolutionMetrics) {
            this.renderPhaseResolutionChart();
        }
    }

    createPriorityChart(priorityCounts) {
        const chart = document.getElementById('priorityChart');
        const total = Object.values(priorityCounts).reduce((a, b) => a + b, 0);
        
        let chartHTML = '<div style="display: flex; flex-direction: column; height: 100%; gap: 5px;">';
        Object.entries(priorityCounts).forEach(([priority, count]) => {
            const percentage = (count / total) * 100;
            chartHTML += `                <div style="display: flex; align-items: center;">
                    <div style="width: 100px;">${priority}</div>
                    <div style="flex: 1; background-color: #dfe1e6; height: 20px; border-radius: 3px;">
                        <div style="width: ${percentage}%; background-color: #0052cc; height: 100%; border-radius: 3px;"></div>
                    </div>
                    <div style="width: 50px; text-align: right;">${count}</div>
                </div>
            `;
        });
        chartHTML += '</div>';
        chart.innerHTML = chartHTML;
    }

    createRiskSummary(issues) {
        const riskSummaryElement = document.getElementById('riskSummary');
        if (!riskSummaryElement) return;
        
        // Reset default chart styles potentially applied
        riskSummaryElement.style.height = 'auto'; 
        riskSummaryElement.style.justifyContent = 'flex-start';
        riskSummaryElement.style.alignItems = 'stretch';
        riskSummaryElement.style.backgroundColor = 'transparent';
        riskSummaryElement.style.padding = '0'; // Remove chart padding

        // Count issues in each risk category and by status
        const riskCounts = { high: 0, medium: 0 };
        const statusCounts = { 'In Progress': 0, 'In Review': 0, 'In QA': 0 };
        const activeStatuses = Object.keys(statusCounts);
        let totalTicketsConsidered = 0;

        issues.forEach(issue => {
            const issueData = this.issueData[issue.key] || {};
            const riskLevel = issueData.riskLevel || 'none';
            const statusCategory = issueData.currentStatusCategory;
            
            // Only consider active statuses for aging counts
            if (statusCategory && activeStatuses.includes(statusCategory)) {
                totalTicketsConsidered++; // Count tickets in relevant statuses
                if (issueData.isAging) {
                     if (riskLevel === 'high') riskCounts.high++;
                     if (riskLevel === 'medium') riskCounts.medium++;
                    statusCounts[statusCategory] = (statusCounts[statusCategory] || 0) + 1;
                }
            }
        });
        
        const totalAging = riskCounts.high + riskCounts.medium;
        const percentageAging = totalTicketsConsidered > 0 ? Math.round(totalAging / totalTicketsConsidered * 100) : 0;

        // Define status colors here so they are always available
        const statusColors = { 'In Progress': '#0052CC', 'In Review': '#6554C0', 'In QA': '#00875A' };

        // Clear previous content
        riskSummaryElement.innerHTML = '';
        
        // Main container for the summary
        const summaryContainer = document.createElement('div');
        summaryContainer.className = 'risk-summary-content';

        // Overall Summary Text
        const overallSummary = document.createElement('div');
        overallSummary.className = 'risk-overall-summary';
        if (totalAging === 0) {
            overallSummary.textContent = 'No aging tickets found in active stages.';
        } else {
            overallSummary.innerHTML = `
                <strong>${totalAging}</strong> aging ticket${totalAging !== 1 ? 's' : ''} 
                found across active stages 
                (${percentageAging}% of ${totalTicketsConsidered} tickets analyzed).
            `;
        }
        summaryContainer.appendChild(overallSummary);

        // Section for Risk Level breakdown
        if (totalAging > 0) {
            const riskLevelSection = document.createElement('div');
            riskLevelSection.className = 'risk-breakdown-section';
            
            const riskTitle = document.createElement('h4');
            riskTitle.textContent = 'By Risk Level:';
            riskLevelSection.appendChild(riskTitle);

            // High Risk Bar
            if (riskCounts.high > 0) {
                riskLevelSection.appendChild(this.createSummaryBar('High', riskCounts.high, totalAging, '#FF5630'));
            }
            // Medium Risk Bar
            if (riskCounts.medium > 0) {
                riskLevelSection.appendChild(this.createSummaryBar('Medium', riskCounts.medium, totalAging, '#FFAB00'));
            }
            summaryContainer.appendChild(riskLevelSection);
        }

        // Section for Status breakdown
        if (totalAging > 0) {
            const statusSection = document.createElement('div');
            statusSection.className = 'risk-breakdown-section';

            const statusTitle = document.createElement('h4');
            statusTitle.textContent = 'By Current Status:';
            statusSection.appendChild(statusTitle);

            activeStatuses.forEach(status => {
                if (statusCounts[status] > 0) {
                    statusSection.appendChild(this.createSummaryBar(status, statusCounts[status], totalAging, statusColors[status]));
                }
            });
            summaryContainer.appendChild(statusSection);
        }

        // Threshold Info Section
        const thresholdSection = document.createElement('div');
        thresholdSection.className = 'risk-threshold-info';
        let thresholdInfoHTML = '<div style="margin-bottom: 5px; font-weight: bold;">Aging Thresholds Used:</div>';
        activeStatuses.forEach(status => {
            const hours = this.riskThresholds[status] || 72;
            const days = Math.round(hours / 24 * 10) / 10;
            thresholdInfoHTML += `<div><span class="status-dot" style="background-color:${statusColors[status] || '#999'};"></span> ${status}: <strong>${hours}h (${days}d)</strong></div>`;
        });
        thresholdInfoHTML += '<div style="margin-top: 5px; font-style: italic;">High risk ≥ 2× threshold, Medium risk ≥ 1× threshold</div>';
        thresholdSection.innerHTML = thresholdInfoHTML;
        summaryContainer.appendChild(thresholdSection);
        
        riskSummaryElement.appendChild(summaryContainer);
    }

    // Helper function to create consistent summary bars
    createSummaryBar(label, count, total, color) {
        const percentage = total > 0 ? Math.round(count / total * 100) : 0;
        
        const barWrapper = document.createElement('div');
        barWrapper.className = 'risk-summary-bar-wrapper';

        const labelDiv = document.createElement('div');
        labelDiv.className = 'risk-summary-label';
        labelDiv.textContent = label;
        labelDiv.style.color = color;

        const barContainer = document.createElement('div');
        barContainer.className = 'risk-summary-bar-container';

        const barFill = document.createElement('div');
        barFill.className = 'risk-summary-bar-fill';
        barFill.style.width = `${percentage}%`;
        barFill.style.backgroundColor = color;

        const countDiv = document.createElement('div');
        countDiv.className = 'risk-summary-count';
        countDiv.textContent = `${count} (${percentage}%)`;

        barContainer.appendChild(barFill);
        barWrapper.appendChild(labelDiv);
        barWrapper.appendChild(barContainer);
        barWrapper.appendChild(countDiv);

        return barWrapper;
    }

    sortTickets(column) {
        // Update sort direction
        if (this.sortConfig.column === column) {
            // If already sorting by this column, toggle direction
            this.sortConfig.direction = this.sortConfig.direction === 'asc' ? 'desc' : 'asc';
        } else {
            // If sorting by a new column, set default direction
            this.sortConfig.column = column;
            this.sortConfig.direction = column === 'created' ? 'desc' : 'asc';
        }
        
        console.log(`Sorting by ${column} in ${this.sortConfig.direction} order`);
        
        // Update sorting indicators in UI
        document.querySelectorAll('th[data-sort]').forEach(header => {
            // Remove all existing sort classes
            header.classList.remove('sort-asc', 'sort-desc');
            
            // Add appropriate sort class if this is the active sort column
            if (header.dataset.sort === this.sortConfig.column) {
                header.classList.add(this.sortConfig.direction === 'asc' ? 'sort-asc' : 'sort-desc');
            }
        });
        
        // No need to sort if no issues
        if (!this.issues || this.issues.length === 0) return;
        
        // Sort the issues array
        this.issues.sort((a, b) => {
            let valueA, valueB;
            
            // Extract the appropriate values based on the column
            switch(column) {
                case 'key':
                    valueA = a.key;
                    valueB = b.key;
                    break;
                case 'summary':
                    valueA = a.fields.summary;
                    valueB = b.fields.summary;
                    break;
                case 'status':
                    valueA = a.fields.status.name;
                    valueB = b.fields.status.name;
                    break;
                case 'priority':
                    valueA = a.fields.priority.name;
                    valueB = b.fields.priority.name;
                    break;
                case 'author':
                    valueA = a.fields.reporter?.displayName || '';
                    valueB = b.fields.reporter?.displayName || '';
                    break;
                case 'assignee':
                    valueA = a.fields.assignee?.displayName || 'Unassigned';
                    valueB = b.fields.assignee?.displayName || 'Unassigned';
                    break;
                case 'created':
                    valueA = new Date(a.fields.created).getTime();
                    valueB = new Date(b.fields.created).getTime();
                    break;
                case 'risk':
                    // For risk sorting, use the numeric risk level (high=3, medium=2, low=1, none=0)
                    valueA = this.getRiskValue(this.issueData[a.key]?.riskLevel || 'none');
                    valueB = this.getRiskValue(this.issueData[b.key]?.riskLevel || 'none');
                    break;
                case 'pingpong':
                    // Sort by ping-pong score
                    valueA = this.issueData[a.key]?.pingPongScore || 0;
                    valueB = this.issueData[b.key]?.pingPongScore || 0;
                    break;
                default:
                    return 0;
            }
            
            // Compare the values
            if (valueA < valueB) {
                return this.sortConfig.direction === 'asc' ? -1 : 1;
            }
            if (valueA > valueB) {
                return this.sortConfig.direction === 'asc' ? 1 : -1;
            }
            return 0;
        });
        
        // Update the table with sorted data
        this.updateTicketTable(this.issues);
    }

    getRiskValue(riskLevel) {
        switch(riskLevel) {
            case 'high': return 3;
            case 'medium': return 2;
            case 'low': return 1;
            default: return 0;
        }
    }

    updateDisplayedTickets() {
        // Get the latest checkbox states
        const atRiskOnlyCheckbox = document.getElementById('atRiskOnlyCheckbox');
        const pingPongOnlyCheckbox = document.getElementById('pingPongOnlyCheckbox');
        const churnOnlyCheckbox = document.getElementById('churnOnlyCheckbox');
        
        // Update the filter states
        this.showingAtRiskOnly = atRiskOnlyCheckbox ? atRiskOnlyCheckbox.checked : false;
        this.showingPingPongOnly = pingPongOnlyCheckbox ? pingPongOnlyCheckbox.checked : false;
        this.showingChurnOnly = churnOnlyCheckbox ? churnOnlyCheckbox.checked : false;
        
        // Filter based on current checkbox states
        let displayedIssues = [...this.issues];
        
        if (this.showingAtRiskOnly) {
            displayedIssues = displayedIssues.filter(issue => this.issueData[issue.key]?.isAging);
        }
        
        if (this.showingPingPongOnly) {
            displayedIssues = displayedIssues.filter(issue => this.issueData[issue.key]?.isPingPong);
        }
        
        // Update the table and metrics
        this.updateTicketTable(displayedIssues);
        this.updateMetrics(displayedIssues);
    }

    updateTicketTable(issues) {
        const tbody = document.getElementById('ticketTableBody');
        tbody.innerHTML = '';
        
        // Debug the issue structure to find reporter and assignee fields
        if (issues.length > 0) {
            console.log('First issue data structure:', issues[0]);
            console.log('First issue fields:', issues[0].fields);
            
            // Check for reporter and assignee fields
            const hasReporter = issues[0].fields.hasOwnProperty('reporter');
            const hasAssignee = issues[0].fields.hasOwnProperty('assignee');
            console.log('Has reporter field:', hasReporter);
            console.log('Has assignee field:', hasAssignee);
            
            // Check the actual structure of these fields
            if (hasReporter) console.log('Reporter structure:', issues[0].fields.reporter);
            if (hasAssignee) console.log('Assignee structure:', issues[0].fields.assignee);
        }
        
        // If table is empty, show a message
        if (issues.length === 0) {
            const emptyRow = document.createElement('tr');
            emptyRow.innerHTML = `
                <td colspan="9" style="text-align: center; padding: 20px;">
                    ${this.showingAtRiskOnly && this.showingPingPongOnly && this.showingChurnOnly ? 'No aging back-and-forth ticket churn tickets found' : 
                     this.showingAtRiskOnly && this.showingPingPongOnly ? 'No aging back-and-forth tickets found' :
                     this.showingPingPongOnly && this.showingChurnOnly ? 'No back-and-forth ticket churn tickets found' :
                     this.showingAtRiskOnly && this.showingChurnOnly ? 'No aging ticket churn tickets found' :
                     this.showingChurnOnly ? 'No ticket churn found' : 'No tickets found'}
                </td>
            `;
            tbody.appendChild(emptyRow);
            return;
        }

        issues.forEach(issue => {
            const row = document.createElement('tr');
            
            // Check if this issue is aging
            const issueData = this.issueData[issue.key] || {};
            
            // --- Get Churn Score/Flag from Backend Metrics (Primary Source) ---
            let churnScore = 0;
            let isChurn = false;
            if (this.resolutionMetrics && 
                this.resolutionMetrics.churn_metrics && 
                this.resolutionMetrics.churn_metrics.tickets_with_scores &&
                this.resolutionMetrics.churn_metrics.tickets_with_scores[issue.key]) {
                
                churnScore = this.resolutionMetrics.churn_metrics.tickets_with_scores[issue.key].score || 0;
            } 
            // Determine isChurn based on the score from backend metrics and the threshold
            isChurn = churnScore >= this.churnThreshold;
            console.log(`Table Render ${issue.key}: Score=${churnScore}, Threshold=${this.churnThreshold}, isChurn=${isChurn}`);
            // --- End Churn Score Fetch ---

            // Fetch aging/risk info separately (still needed for Aging column)
            const isAging = issueData.isAging || false;
            const riskLevel = issueData.riskLevel || 'none';
            const timeInStatus = issueData.timeInStatus || '';
            
            // console.log(`Ticket ${issue.key} - Churn Score: ${churnScore}, isChurn: ${isChurn}`); // Updated log
            
            // Better extraction of author and assignee information
            // Try different paths and field names that might contain this data
            let author = 'Unknown';
            let assignee = 'Unassigned';
            
            // For author/reporter
            if (issue.fields.reporter) {
                if (issue.fields.reporter.displayName) {
                    author = issue.fields.reporter.displayName;
                } else if (issue.fields.reporter.name) {
                    author = issue.fields.reporter.name;
                } else if (typeof issue.fields.reporter === 'string') {
                    author = issue.fields.reporter;
                }
            } else if (issue.fields.creator && issue.fields.creator.displayName) {
                author = issue.fields.creator.displayName;
            }
            
            // For assignee
            if (issue.fields.assignee) {
                if (issue.fields.assignee.displayName) {
                    assignee = issue.fields.assignee.displayName;
                } else if (issue.fields.assignee.name) {
                    assignee = issue.fields.assignee.name;
                } else if (typeof issue.fields.assignee === 'string') {
                    assignee = issue.fields.assignee;
                }
            }
            
            console.log(`Ticket ${issue.key} - Found Author: ${author}, Assignee: ${assignee}`);
            
            // Set row color based on risk level
            if (riskLevel === 'high') {
                row.style.backgroundColor = '#ffe2dd'; // Light red
            } else if (riskLevel === 'medium') {
                row.style.backgroundColor = '#fff0b3'; // Light yellow
            } else if (riskLevel === 'low') {
                row.style.backgroundColor = '#e3fcef'; // Light green
            }
            
            // If it's a ping-pong ticket, add a border
            if (issueData.isPingPong) {
                row.style.border = '2px dashed #6554C0'; // Purple border for back-and-forth tickets
            }
            
            // If it's a ticket churn, add a border
            if (isChurn) {
                row.style.border = '2px dashed #6554C0'; // Purple border for ticket churn tickets
            }
            
            // If it's a high churn ticket, add a specific class for styling
            if (isChurn) {
                row.classList.add('high-churn-row');
            } else {
                 row.classList.remove('high-churn-row'); // Ensure class is removed if not churn
            }
            
            row.innerHTML = `
                <td><a href="${this.jiraUrl}/browse/${issue.key}" target="_blank">${issue.key}</a></td>
                <td>${issue.fields.summary}</td>
                <td>
                    ${issue.fields.status.name}
                    ${isAging ? `<div style="font-size: 0.8em; color: #666;">${timeInStatus}</div>` : ''}
                </td>
                <td>${issue.fields.priority.name}</td>
                <td style="background-color: #f0f4ff; min-width: 80px;">${author}</td>
                <td style="background-color: #f0fff4; min-width: 80px;">${assignee}</td>
                <td>${new Date(issue.fields.created).toLocaleDateString()}</td>
                <td>
                    ${isAging ? `
                        <span class="risk-badge" style="display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; font-weight: bold; color: white; background-color: ${
                            riskLevel === 'high' ? '#FF5630' : 
                            riskLevel === 'medium' ? '#FFAB00' : 
                            '#36B37E'
                        };">
                            ${riskLevel.toUpperCase()}
                        </span>
                    ` : ''}
                </td>
                <td>
                    ${issueData.isPingPong && issueData.pingPongScore > 0 ? `
                        <span class="ticket-churn-badge" style="display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; font-weight: bold; color: white; background-color: #6554C0;">
                            ${issueData.pingPongScore}
                        </span>
                    ` : ''}
                </td>
                <td>
                    ${isChurn ? `
                        <span class="ticket-churn-badge" style="display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 0.85em; font-weight: bold; color: white; background-color: #6554C0;" title="Ticket Churn Score: ${churnScore}">
                            ${churnScore}
                        </span>
                    ` : '-'} 
                </td>
            `;
            
            // Make the entire row clickable to show status durations
            row.style.cursor = 'pointer';
            row.addEventListener('click', () => this.showStatusDurations(issue.key));
            
            tbody.appendChild(row);
        });
        
        // Initialize modal close button
        const closeModalBtn = document.getElementById('closeModalBtn');
        if (closeModalBtn) {
            closeModalBtn.addEventListener('click', () => {
                document.getElementById('statusModal').style.display = 'none';
            });
        }
    }
    
    async showStatusDurations(issueKey) {
        console.log(`Showing status durations for ${issueKey}`);
        
        // Show modal with loading state
        const modal = document.getElementById('statusModal');
        const modalTitle = document.getElementById('modalTitle');
        const statusDurationChart = document.getElementById('statusDurationChart');
        const statusDurationDetails = document.getElementById('statusDurationDetails');
        const statusTimeline = document.getElementById('statusTimeline');
        const pingPongSection = document.getElementById('statusPingPongSection') || this.createPingPongSection();
        const churnSection = document.getElementById('statusChurnSection') || this.createChurnSection();
        
        if (!modal || !modalTitle || !statusDurationChart || !statusDurationDetails || !statusTimeline || !pingPongSection || !churnSection) {
            console.error('Modal elements not found');
            return;
        }
        
        // Set loading state
        modalTitle.textContent = `Analyzing Status Timeline for ${issueKey}`;
        statusDurationChart.innerHTML = '<div style="text-align: center; padding: 20px;">Loading status data...</div>';
        statusDurationDetails.innerHTML = '';
        statusTimeline.innerHTML = '';
        if (pingPongSection) pingPongSection.innerHTML = '';
        if (churnSection) churnSection.innerHTML = '';
        modal.style.display = 'block';
        
        // Check if we already have the data
        if (this.issueData[issueKey]) {
            this.displayStatusData(issueKey, this.issueData[issueKey]);
            return;
        }
        
        // Otherwise fetch it
        try {
            // Fetch status history data
            fetch(`${this.proxyUrl}${this.proxyEndpoint}/issue-history/${issueKey}`)
                .then(response => {
                    if (!response.ok) {
                        throw new Error(`Failed to fetch status history: ${response.status}`);
                    }
                    return response.json();
                })
                .then(data => {
                    // Store the data
                    this.issueData[issueKey] = data;
                    // Display it
                    this.displayStatusData(issueKey, data);
                })
                .catch(error => {
                    console.error('Error fetching status data:', error);
                    statusDurationChart.innerHTML = `<div style="color: red; text-align: center; padding: 20px;">
                        Error loading status data: ${error.message}
                    </div>`;
                });
        } catch (error) {
            console.error('Error fetching status data:', error);
            statusDurationChart.innerHTML = `<div style="color: red; text-align: center; padding: 20px;">
                Error loading status data: ${error.message}
            </div>`;
        }
    }
    
    displayStatusData(issueKey, data) {
        const modalTitle = document.getElementById('modalTitle');
        const statusDurationChart = document.getElementById('statusDurationChart');
        const statusDurationDetails = document.getElementById('statusDurationDetails');
        const statusTimeline = document.getElementById('statusTimeline');
        const pingPongSection = document.getElementById('statusPingPongSection') || this.createPingPongSection();
        const churnSection = document.getElementById('statusChurnSection') || this.createChurnSection();
        
        // Update modal title with issue key and summary if available
        if (data.summary) {
            modalTitle.textContent = `${issueKey}: ${data.summary}`;
        } else {
            modalTitle.textContent = `Status Timeline for ${issueKey}`;
        }
        
        // Add ticket summary information
        let summaryHTML = `
            <div style="background-color: #F4F5F7; padding: 12px; border-radius: 4px; margin-bottom: 15px;">
                <div><strong>Current Status:</strong> ${data.current_status || 'Unknown'}</div>
                <div style="display: flex; margin-top: 5px;">
                    <div style="flex: 1;"><strong>Created:</strong> ${data.created ? new Date(data.created).toLocaleString() : 'Unknown'}</div>
                    <div style="flex: 1;"><strong>Resolved:</strong> ${data.resolution_date ? new Date(data.resolution_date).toLocaleString() : 'Not resolved'}</div>
                </div>
        `;
        
        // Check if any status is aging
        let hasAgingStatus = false;
        if (data.status_durations) {
            for (const [status, statusData] of Object.entries(data.status_durations)) {
                // Use continuous_time if available, fallback to current_duration
                const continuousTime = statusData.continuous_time || statusData.current_duration;
                
                if (continuousTime && ['In Progress', 'In Review', 'In QA'].includes(status) && continuousTime >= 72) {
                    hasAgingStatus = true;
                    summaryHTML += `
                        <div style="margin-top: 5px; color: #DE350B; font-weight: bold;">
                            ⚠️ This ticket has been in ${status} continuously for ${this.formatDuration(continuousTime)} (exceeds 3-day threshold)
                        </div>
                    `;
                    break;
                }
            }
        }
        
        summaryHTML += `</div>`;
        
        // Insert the summary at the top of the status duration chart
        statusDurationChart.innerHTML = summaryHTML + '<div id="statusChartContent"></div>';
        const chartContent = document.getElementById('statusChartContent');
        
        // Create the status duration chart
        this.renderStatusDurationChart(chartContent, data.status_durations);
        
        // Show detailed status information
        this.renderStatusDetails(statusDurationDetails, data.status_durations);
        
        // Show status transition timeline
        this.renderStatusTimeline(statusTimeline, data.status_changes);
        
        // --- Refactored Churn/PingPong Data Fetching ---
        let finalChurnScore = 0;
        let finalTransitions = [];

        // Use data ONLY from the resolution metrics calculation as the source of truth
        if (this.resolutionMetrics && 
            this.resolutionMetrics.churn_metrics && 
            this.resolutionMetrics.churn_metrics.tickets_with_scores &&
            this.resolutionMetrics.churn_metrics.tickets_with_scores[issueKey]) {
            
            const churnData = this.resolutionMetrics.churn_metrics.tickets_with_scores[issueKey];
            finalChurnScore = churnData.score || 0;
            finalTransitions = churnData.transitions || []; 
            console.log(`Using churn score (${finalChurnScore}) and ${finalTransitions.length} transitions from resolutionMetrics for ${issueKey}`);
        
        } else {
            // If ticket not in backend churn results, its score is effectively 0 for display purposes
            console.log(`Churn data for ${issueKey} not found in resolutionMetrics. Displaying score as 0.`);
            finalChurnScore = 0;
            finalTransitions = []; 
            // // Fallback logic removed - rely solely on backend metrics result
            // console.warn(`Churn data for ${issueKey} not found in resolutionMetrics. Falling back to issueData.`);
            // if (this.issueData[issueKey] && this.issueData[issueKey].churnScore !== undefined) {
            //     finalChurnScore = this.issueData[issueKey].churnScore;
            //     finalTransitions = this.issueData[issueKey].statusTransitions || []; 
            // } else {
            //      console.warn(`No pre-calculated churn data found for ${issueKey} in issueData either.`);
            // }
        }
        // --- End Refactor ---

        // Show ping-pong/churn information using the correctly sourced data
        // NOTE: Assuming renderPingPongAnalysis and renderChurnAnalysis are essentially the same visualization.
        // If they need different data sources later, this logic needs adjustment.
        this.renderPingPongAnalysis(pingPongSection, finalChurnScore, finalTransitions);
        // Remove the separate call to renderChurnAnalysis as renderPingPongAnalysis handles the display
        // this.renderChurnAnalysis(churnSection, churnScore, transitions);
    }
    
    createPingPongSection() {
        // Create the ping-pong section if it doesn't exist
        const modalContent = document.getElementById('modalContent');
        const pingPongSection = document.createElement('div');
        pingPongSection.id = 'statusPingPongSection';
        pingPongSection.className = 'status-ping-pong';
        
        // Just append to modalContent instead of trying to insertBefore closeModalBtn
        // The closeModalBtn is outside of modalContent in the HTML structure
        modalContent.appendChild(pingPongSection);
        
        return pingPongSection;
    }
    
    createChurnSection() {
        // Create the churn section if it doesn't exist
        const modalContent = document.getElementById('modalContent');
        const churnSection = document.createElement('div');
        churnSection.id = 'statusChurnSection';
        churnSection.className = 'status-churn';
        
        // Append to modalContent
        modalContent.appendChild(churnSection);
        
        return churnSection;
    }
    
    renderPingPongAnalysis(container, pingPongScore, transitions) {
        if (!transitions || Object.keys(transitions).length === 0) {
            container.innerHTML = '';
            return;
        }
        
        const isPingPong = pingPongScore >= this.pingPongThreshold;
        
        let html = `
            <div style="margin-top: 20px; border-radius: 5px; border: 1px solid #dfe1e6; overflow: hidden; max-height: 500px; display: flex; flex-direction: column;">
                <div style="padding: 15px; background-color: ${isPingPong ? '#EAE6FF' : '#F4F5F7'}; border-bottom: 1px solid #dfe1e6; flex-shrink: 0;">
                    <h3 style="margin: 0; color: ${isPingPong ? '#6554C0' : '#172B4D'};">Ticket Churn Analysis</h3>
                </div>
                
                <div style="padding: 15px; overflow-y: auto; flex-grow: 1;">
                    ${isPingPong ? `
                        <div style="margin-bottom: 15px; padding: 10px; background-color: #F0F0FF; border-radius: 3px; border-left: 3px solid #6554C0; flex-shrink: 0;">
                            <span style="font-weight: bold; color: #6554C0;">⚠️ This ticket has a high amount of ticket churn.</span>
                        </div>
                    ` : ''}
                    
                    <div style="margin-bottom: 15px; flex-shrink: 0;">
                        <div style="font-size: 16px; margin-bottom: 5px;"><strong>Ticket churn score:</strong> 
                            <span style="display: inline-block; padding: 2px 10px; background-color: ${
                                pingPongScore >= this.pingPongThreshold ? '#6554C0' : 
                                pingPongScore >= this.pingPongThreshold/2 ? '#00B8D9' : '#DFE1E6'
                            }; color: ${pingPongScore >= this.pingPongThreshold/2 ? 'white' : '#172B4D'}; border-radius: 10px; font-weight: bold;">
                                ${pingPongScore}
                            </span>
                        </div>
                        <div style="font-size: 13px; color: #5E6C84;">
                            Scores of ${this.pingPongThreshold} or higher indicate problematic ticket churn.
                        </div>
                    </div>
        `;
        
        // Add transition analysis
        if (transitions) {
            html += `<div style="margin-bottom: 15px;">
                <h4 style="margin-top: 0; margin-bottom: 10px;">Status Transitions:</h4>
                <table style="width: 100%; border-collapse: collapse; font-size: 13px;">
            `;
            
            // Group transitions by type
            const transitionCounts = {};
            
            transitions.forEach(t => {
                const key = `${t.from}<->${t.to}`;
                if (!transitionCounts[key]) {
                    transitionCounts[key] = {
                        from: t.from, 
                        to: t.to,
                        count: 0
                    };
                }
                transitionCounts[key].count++;
            });
            
            // Sort transitions by count (descending)
            const sortedTransitions = Object.values(transitionCounts).sort((a, b) => b.count - a.count);
            
            // Add each transition type
            sortedTransitions.forEach(t => {
                // --- Add this check ---
                if (t.from === t.to) {
                    console.log(`Skipping same-stage transition in churn table: ${t.from} -> ${t.to}`);
                    return; // Skip rendering if from and to stages are the same
                }
                // --- End check ---
                html += `
                    <tr style="border-bottom: 1px solid #DFE1E6;">
                        <td style="padding: 8px 0;">
                            <strong>${t.from}</strong><span style="color: #6B778C; margin: 0 5px;">→</span><strong>${t.to}</strong>
                        </td>
                        <td style="padding: 8px 0; text-align: right;">
                            ${t.count}x
                        </td>
                    </tr>
                `;
            });
            
            html += `</table></div>`;
        }
        
        // Add explanation of ping-pong patterns
        html += `
                    <div style="margin-top: 15px; font-size: 13px; color: #5E6C84; padding: 10px; background-color: #F4F5F7; border-radius: 3px; flex-shrink: 0;">
                        <p><strong>About ticket churn analysis:</strong> This analysis detects when a ticket moves backward in the workflow, counting each backward movement as 1 point.</p>
                        <p>Backward movements include:</p>
                        <ul style="margin-top: 5px; padding-left: 20px;">
                            <li>Moving from In Progress back to To Do</li>
                            <li>Moving from In Review back to In Progress</li>
                            <li>Moving from In QA back to In Review or In Progress</li>
                            <li>Moving from Done back to any status</li>
                        </ul>
                    </div>
                </div>
            </div>
        `;
        
        container.innerHTML = html;
    }

    renderStatusDurationChart(container, statusDurations) {
        // If no status durations, show a message
        if (!statusDurations || Object.keys(statusDurations).length === 0) {
            container.innerHTML = '<div style="text-align: center; padding: 20px;">No status data available</div>';
            return;
        }
        
        // Transform the new data structure format for chart display
        const durations = {};
        const totalHoursObj = { value: 0 };
        
        // Process status durations in the new format
        Object.entries(statusDurations).forEach(([status, data]) => {
            // Use total_hours as the primary metric for the chart
            durations[status] = data.total_hours;
            totalHoursObj.value += data.total_hours;
        });
        
        // Sort statuses by duration (descending)
        const sortedStatuses = Object.entries(durations)
            .sort(([, durationA], [, durationB]) => durationB - durationA);
            
        // Generate HTML for the chart
        let chartHTML = '<div style="width: 100%; margin: 15px 0;">';
        
        // List of active statuses we care about for aging
        const activeStatuses = ['In Progress', 'In Review', 'In QA'];
        
        // Add the status bars
        sortedStatuses.forEach(([status, hours]) => {
            const percentage = (hours / totalHoursObj.value) * 100;
            const formattedHours = this.formatDuration(hours);
            
            // Choose color based on status name
            let color = this.getStatusColor(status);
            
            // Highlight aging statuses (only for active statuses, not Todo or Done)
            const isAgingStatus = activeStatuses.includes(status);
            const isCurrentlyInStatus = statusDurations[status].hasOwnProperty('current_duration');
            
            // Use continuous_time if available, fall back to current_duration
            const continuousTime = statusDurations[status].continuous_time || statusDurations[status].current_duration;
            const isAging = isCurrentlyInStatus && isAgingStatus && continuousTime >= 72; // 3 days
            
            // Add warning for aging statuses with continuous time
            let agingWarning = '';
            if (isAging) {
                agingWarning = `
                    <div style="margin-left: 10px; color: #FF5630; font-weight: bold;">
                        ⚠️ ${this.formatDuration(continuousTime)} continuously (Aging)
                    </div>
                `;
            }
            
            // Show continuous time if it's the current status
            let currentInfo = '';
            if (isCurrentlyInStatus) {
                // Show both continuous time and total if they differ
                const currentDuration = statusDurations[status].current_duration;
                if (Math.abs(hours - currentDuration) > 1 && currentDuration > 1) { // More than 1 hour difference
                    currentInfo = `
                        <div style="font-size: 0.85em; color: #666; margin-top: 4px;">
                            Current visit: ${this.formatDuration(currentDuration)} • Total accumulated: ${formattedHours}
                        </div>
                    `;
                }
            }
            
            chartHTML += `
                <div style="margin-bottom: 12px;">
                    <div style="display: flex; align-items: center; margin-bottom: 4px;">
                        <div style="width: 120px; font-weight: bold;">${status}:</div>
                        <div style="margin-left: 10px;">${formattedHours} (${percentage.toFixed(1)}%)</div>
                        ${agingWarning}
                    </div>
                    <div style="background-color: #eee; height: 20px; border-radius: 4px; overflow: hidden; ${isAging ? 'border: 2px solid #FF5630;' : ''}">
                        <div style="width: ${percentage}%; background-color: ${color}; height: 100%;"></div>
                    </div>
                    ${currentInfo}
                </div>
            `;
        });
        
        chartHTML += '</div>';
        container.innerHTML = chartHTML;
    }
    
    renderStatusDetails(container, statusDurations) {
        if (!statusDurations || Object.keys(statusDurations).length === 0) {
            container.innerHTML = '';
            return;
        }
        
        // Transform the new data structure
        const durations = {};
        let totalHours = 0;
        
        // Process status durations in the new format
        Object.entries(statusDurations).forEach(([status, data]) => {
            durations[status] = data.total_hours;
            totalHours += data.total_hours;
        });
        
        // List of active statuses we care about for aging
        const activeStatuses = ['In Progress', 'In Review', 'In QA'];
        
        let detailsHTML = `
            <div style="margin-top: 20px;">
                <h3>Status Details</h3>
                <p>Total time tracked: ${this.formatDuration(totalHours)}</p>
                <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
                    <thead>
                        <tr>
                            <th style="text-align: left; padding: 8px; border-bottom: 1px solid #ddd;">Status</th>
                            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">Current Visit</th>
                            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">Total Time</th>
                            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">Times Visited</th>
                            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">Avg Time</th>
                            <th style="text-align: right; padding: 8px; border-bottom: 1px solid #ddd;">% of Total</th>
                        </tr>
                    </thead>
                    <tbody>
        `;
        
        // Sort statuses alphabetically for the details table
        const sortedStatuses = Object.entries(statusDurations).sort(([statusA], [statusB]) => statusA.localeCompare(statusB));
        
        sortedStatuses.forEach(([status, data]) => {
            const hours = data.total_hours;
            const count = data.count;
            const avgHours = data.average_hours;
            const percentage = (hours / totalHours) * 100;
            
            // Highlight aging statuses (only for active statuses, not Todo or Done)
            const isAgingStatus = activeStatuses.includes(status);
            const isCurrentlyInStatus = data.hasOwnProperty('current_duration');
            
            // Use continuous_time if available, fall back to current_duration 
            const continuousTime = data.continuous_time || data.current_duration;
            const isAging = isCurrentlyInStatus && isAgingStatus && continuousTime >= 72; // 3 days
            
            // Current visit column
            const currentTimeCell = isCurrentlyInStatus ? 
                this.formatDuration(data.current_duration) : 
                '-';
            
            detailsHTML += `
                <tr ${isAging ? 'style="background-color: #fff0f0;"' : ''}>
                    <td style="padding: 8px; border-bottom: 1px solid #eee;">
                        ${status}
                        ${isCurrentlyInStatus ? ' (current)' : ''}
                        ${isAging ? ' ⚠️' : ''}
                    </td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${currentTimeCell}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${this.formatDuration(hours)}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${count}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${this.formatDuration(avgHours)}</td>
                    <td style="text-align: right; padding: 8px; border-bottom: 1px solid #eee;">${percentage.toFixed(1)}%</td>
                </tr>
            `;
        });
        
        detailsHTML += `
                    </tbody>
                </table>
                <div style="margin-top: 10px; font-size: 0.85em; color: #666;">
                    <p><strong>Note:</strong> "Current Visit" shows time spent in this status since the most recent change to this status. 
                    "Total Time" includes all time ever spent in this status across multiple visits.</p>
                </div>
            </div>
        `;
        
        container.innerHTML = detailsHTML;
    }
    
    renderStatusTimeline(container, statusChanges) {
        if (!statusChanges || statusChanges.length === 0) {
            container.innerHTML = '';
            return;
        }
        
        let timelineHTML = `
            <div style="margin-top: 20px;">
                <h3>Status Timeline</h3>
                <div style="margin-top: 10px;">
        `;
        
        // Process all status changes except the initial one (index 0)
        for (let i = 1; i < statusChanges.length; i++) {
            const change = statusChanges[i];
            const date = new Date(change.date);
            const formattedDate = date.toLocaleString();
            
            // Get the from and to statuses
            const fromStatus = change.from || 'Unknown';
            const toStatus = change.to || 'Unknown';

            if (fromStatus === toStatus) {
                console.log(`Skipping same-status transition: ${fromStatus} -> ${toStatus}`);
                continue; // Skip this iteration if from and to statuses are the same
            }
            
            // Get colors for the key workflow states
            let toColor = this.getStatusColor(toStatus);
            
            // Check if this is a ping-pong transition
            const isPingPong = (
                (fromStatus === 'In QA' && toStatus === 'In Review') ||
                (fromStatus === 'In Review' && toStatus === 'In Progress') ||
                (fromStatus === 'In Progress' && toStatus === 'To Do')
            );
            
            // Add author if available
            const author = change.author ? ` by ${change.author}` : '';
            
            timelineHTML += `
                <div style="display: flex; margin-bottom: 15px;">
                    <div style="width: 120px; font-size: 0.9em; color: #666;">${formattedDate}</div>
                    <div style="margin-left: 20px; position: relative;">
                        <div style="position: absolute; left: -14px; top: 0; width: 8px; height: 8px; border-radius: 50%; background-color: ${isPingPong ? '#FF5630' : '#0052cc'};"></div>
                        <div style="padding-bottom: 5px;">
                            <strong>Status Changed${author}</strong>
                            ${isPingPong ? ' <span style="color: #FF5630; font-weight: bold;">⚠️ Potential ping-pong</span>' : ''}
                        </div>
                        <div style="color: #666;">From: ${fromStatus}</div>
                        <div style="color: ${toColor};">To: ${toStatus}</div>
                    </div>
                </div>
            `;
            
            // Add connector line between points (except for the last one)
            if (i < statusChanges.length - 1) {
                timelineHTML += `
                    <div style="display: flex;">
                        <div style="width: 120px;"></div>
                        <div style="margin-left: 20px; position: relative;">
                            <div style="position: absolute; left: -10px; top: -10px; width: 1px; height: 20px; background-color: #ccc;"></div>
                        </div>
                    </div>
                `;
            }
        }
        
        // Add ticket creation date at the end (chronologically first)
        if (statusChanges.length > 0) {
            const firstChange = statusChanges[0];
            const creationDate = new Date(firstChange.date);
            const formattedCreationDate = creationDate.toLocaleString();
            
            // Add connector line to the creation date
            timelineHTML += `
                <div style="display: flex;">
                    <div style="width: 120px;"></div>
                    <div style="margin-left: 20px; position: relative;">
                        <div style="position: absolute; left: -10px; top: -10px; width: 1px; height: 20px; background-color: #ccc;"></div>
                    </div>
                </div>
            `;
            
            // Add ticket creation entry (without showing initial status)
            timelineHTML += `
                <div style="display: flex; margin-bottom: 15px;">
                    <div style="width: 120px; font-size: 0.9em; color: #666;">${formattedCreationDate}</div>
                    <div style="margin-left: 20px; position: relative;">
                        <div style="position: absolute; left: -14px; top: 0; width: 8px; height: 8px; border-radius: 50%; background-color: #6554C0;"></div>
                        <div style="padding-bottom: 5px;"><strong>Ticket Created</strong></div>
                    </div>
                </div>
            `;
        }
        
        timelineHTML += `
                </div>
            </div>
        `;
        
        container.innerHTML = timelineHTML;
    }
    
    formatDuration(hours) {
        if (hours < 1) {
            // Less than 1 hour, show in minutes
            const minutes = Math.round(hours * 60);
            return `${minutes} minute${minutes !== 1 ? 's' : ''}`;
        } else if (hours < 24) {
            // Less than 24 hours, show in hours
            const roundedHours = Math.round(hours * 10) / 10;
            return `${roundedHours} hour${roundedHours !== 1 ? 's' : ''}`;
        } else {
            // More than 24 hours, show in days
            const days = Math.round(hours / 24 * 10) / 10;
            return `${days} day${days !== 1 ? 's' : ''}`;
        }
    }
    
    getStatusColor(status) {
        // Map status names to common Jira colors
        const statusLower = status.toLowerCase();
        
        if (statusLower.includes('done') || statusLower.includes('complete') || statusLower.includes('closed')) {
            return '#36B37E'; // Green
        } else if (statusLower.includes('progress') || statusLower.includes('review') || statusLower.includes('testing')) {
            return '#4C9AFF'; // Blue
        } else if (statusLower.includes('open') || statusLower.includes('todo') || statusLower.includes('backlog')) {
            return '#6554C0'; // Purple
        } else if (statusLower.includes('block') || statusLower.includes('hold')) {
            return '#FF5630'; // Red
        } else {
            return '#00B8D9'; // Teal (default)
        }
    }

    applyFilters(issues) {
        return issues.filter(issue => {
            const issueData = this.issueData[issue.key];
            
            if (this.filters.highRisk && !issueData.isHighRisk) {
                return false;
            }
            
            if (this.filters.stalled && !issueData.isStalled) {
                return false;
            }
            
            if (this.filters.blocking && !issueData.isBlocking) {
                return false;
            }
            
            if (this.filters.pingPong && !issueData.isPingPong) {
                return false;
            }
            
            return true;
        });
    }

    createIssueCard(issue) {
        const issueData = this.issueData[issue.key];
        const card = document.createElement('div');
        card.className = 'issue-card';
        
        // Add indicators for special issue types
        const indicators = document.createElement('div');
        indicators.className = 'indicators';
        
        if (issueData.isHighRisk) {
            this.addIndicator(indicators, 'HIGH RISK', 'high-risk');
        }
        
        if (issueData.isStalled) {
            this.addIndicator(indicators, 'STALLED', 'stalled');
        }
        
        if (issueData.isBlocking) {
            this.addIndicator(indicators, 'BLOCKING', 'blocking');
        }
        
        if (issueData.isPingPong) {
            this.addIndicator(indicators, 'PING-PONG', 'ping-pong');
        }
        
        // Create the card content
        const content = document.createElement('div');
        content.className = 'issue-content';
        
        const title = document.createElement('h3');
        title.innerHTML = `<a href="${this.jiraUrl}/browse/${issue.key}" target="_blank">${issue.key}</a>: ${issueData.summary}`;
        
        const details = document.createElement('div');
        details.className = 'issue-details';
        details.innerHTML = `
            <p><strong>Status:</strong> ${issueData.status}</p>
            <p><strong>Assignee:</strong> ${issueData.assignee}</p>
            <p><strong>Last Updated:</strong> ${issueData.daysSinceUpdated} days ago</p>
        `;
        
        // Add ping-pong details if relevant
        if (issueData.isPingPong) {
            const pingPongDetails = document.createElement('div');
            pingPongDetails.className = 'ping-pong-details';
            pingPongDetails.innerHTML = `
                <h4>Ping-Pong Score: ${issueData.pingPongScore}</h4>
                <p>The issue has moved back and forth between statuses multiple times:</p>
                <ul>
                    ${issueData.pingPongTransitions.map(t => `<li>${t}</li>`).join('')}
                </ul>
            `;
            details.appendChild(pingPongDetails);
        }
        
        // Add blocked by details if relevant
        if (issueData.isBlocking) {
            const blockingDetails = document.createElement('div');
            blockingDetails.className = 'blocking-details';
            blockingDetails.innerHTML = `
                <h4>Blocking:</h4>
                <ul>
                    ${issueData.blockedBy.map(key => `<li><a href="${this.jiraUrl}/browse/${key}" target="_blank">${key}</a></li>`).join('')}
                </ul>
            `;
            details.appendChild(blockingDetails);
        }
        
        content.appendChild(title);
        content.appendChild(details);
        
        card.appendChild(indicators);
        card.appendChild(content);
        
        return card;
    }

    addStyles() {
        const style = document.createElement('style');
        style.textContent = `
            /* General styles */
            body {
                font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
                margin: 0;
                padding: 0;
                background-color: #f4f5f7;
                color: #172b4d;
            }
            
            #app-container {
                max-width: 1200px;
                margin: 0 auto;
                padding: 20px;
            }
            
            /* Header styles */
            .app-header {
                margin-bottom: 20px;
            }
            
            .app-header h1 {
                color: #172b4d;
            }
            
            /* Config section */
            .config-section {
                background-color: #ffffff;
                padding: 20px;
                border-radius: 5px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
                margin-bottom: 20px;
                display: flex;
                gap: 10px;
            }
            
            .config-section input {
                padding: 10px;
                border: 1px solid #dfe1e6;
                border-radius: 3px;
                flex-grow: 1;
            }
            
            .config-section button {
                padding: 10px 15px;
                background-color: #0052cc;
                color: white;
                border: none;
                border-radius: 3px;
                cursor: pointer;
            }
            
            /* Filter panel */
            .filter-panel {
                background-color: #ffffff;
                padding: 15px;
                border-radius: 5px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
                margin-bottom: 20px;
                display: flex;
                gap: 15px;
            }
            
            .filter-container {
                display: flex;
                align-items: center;
                gap: 5px;
            }
            
            /* Issue cards */
            .content {
                display: grid;
                grid-template-columns: repeat(auto-fill, minmax(350px, 1fr));
                gap: 20px;
            }
            
            .issue-card {
                background-color: #ffffff;
                border-radius: 5px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
                overflow: hidden;
                position: relative;
            }
            
            .indicators {
                display: flex;
                flex-wrap: wrap;
                gap: 5px;
                padding: 10px;
                background-color: #f4f5f7;
            }
            
            .indicator {
                padding: 3px 8px;
                border-radius: 3px;
                font-size: 12px;
                font-weight: bold;
            }
            
            .high-risk {
                background-color: #ff5630;
                color: white;
            }
            
            .stalled {
                background-color: #ffab00;
                color: #172b4d;
            }
            
            .blocking {
                background-color: #6554c0;
                color: white;
            }
            
            .ping-pong {
                background-color: #00b8d9;
                color: white;
            }
            
            .issue-content {
                padding: 15px;
            }
            
            .issue-content h3 {
                margin-top: 0;
                margin-bottom: 10px;
            }
            
            .issue-content a {
                color: #0052cc;
                text-decoration: none;
            }
            
            .issue-content a:hover {
                text-decoration: underline;
            }
            
            .issue-details {
                font-size: 14px;
            }
            
            .ping-pong-details, .blocking-details {
                margin-top: 15px;
                padding: 10px;
                background-color: #f4f5f7;
                border-radius: 3px;
            }
            
            .ping-pong-details h4, .blocking-details h4 {
                margin-top: 0;
                margin-bottom: 10px;
            }
            
            /* Summary section */
            .summary {
                grid-column: 1 / -1;
                background-color: #ffffff;
                padding: 15px;
                border-radius: 5px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
                margin-top: 20px;
            }
            
            .no-issues {
                grid-column: 1 / -1;
                padding: 30px;
                text-align: center;
                background-color: #ffffff;
                border-radius: 5px;
                box-shadow: 0 1px 3px rgba(0, 0, 0, 0.12);
            }
        `;
        
        document.head.appendChild(style);
    }

    // Add this method to create the filter panel
    createFilterPanel() {
        const filterPanel = document.createElement('div');
        filterPanel.className = 'filter-panel';
        
        // Create filter inputs
        const filters = [
            { id: 'filter-high-risk', label: 'High Risk', filter: 'highRisk' },
            { id: 'filter-stalled', label: 'Stalled', filter: 'stalled' },
            { id: 'filter-ping-pong', label: 'Ticket Churn', filter: 'pingPong' },
            { id: 'filter-blocking', label: 'Blocking', filter: 'blocking' }
        ];
        
        filters.forEach(filterObj => {
            const filterContainer = document.createElement('div');
            filterContainer.className = 'filter-container';
            
            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.id = filterObj.id;
            
            const label = document.createElement('label');
            label.htmlFor = filterObj.id;
            label.textContent = filterObj.label;
            
            checkbox.addEventListener('change', () => {
                this.filters[filterObj.filter] = checkbox.checked;
                this.renderIssues();
            });
            
            filterContainer.appendChild(checkbox);
            filterContainer.appendChild(label);
            filterPanel.appendChild(filterContainer);
        });
        
        return filterPanel;
    }

    // Update the renderUI method to include the filter panel
    renderUI() {
        this.container.innerHTML = '';
        
        // Create header
        const header = document.createElement('header');
        header.className = 'app-header';
        
        const title = document.createElement('h1');
        title.textContent = 'Jira Risk Analysis';
        header.appendChild(title);
        
        // Create Jira configuration section
        const configSection = document.createElement('div');
        configSection.className = 'config-section';
        
        const jiraUrlInput = document.createElement('input');
        jiraUrlInput.type = 'text';
        jiraUrlInput.id = 'jira-url';
        jiraUrlInput.placeholder = 'Jira URL (e.g. https://your-domain.atlassian.net)';
        jiraUrlInput.value = this.jiraUrl || '';
        
        const jiraTokenInput = document.createElement('input');
        jiraTokenInput.type = 'password';
        jiraTokenInput.id = 'jira-token';
        jiraTokenInput.placeholder = 'Jira API Token';
        
        const jiraFetchButton = document.createElement('button');
        jiraFetchButton.id = 'fetch-button';
        jiraFetchButton.textContent = 'Fetch Data';
        jiraFetchButton.addEventListener('click', () => this.fetchData());
        
        configSection.appendChild(jiraUrlInput);
        configSection.appendChild(jiraTokenInput);
        configSection.appendChild(jiraFetchButton);
        
        // Add filter panel
        const filterPanel = this.createFilterPanel();
        
        // Create content area
        const content = document.createElement('div');
        content.className = 'content';
        content.id = 'issues-container';
        
        // Assemble UI
        this.container.appendChild(header);
        this.container.appendChild(configSection);
        this.container.appendChild(filterPanel);
        this.container.appendChild(content);
        
        // Add styles
        this.addStyles();
    }

    // Update renderIssues to use the filter
    renderIssues() {
        const container = document.getElementById('issues-container');
        container.innerHTML = '';
        
        if (!this.issues || this.issues.length === 0) {
            container.innerHTML = '<div class="no-issues">No issues found or data not loaded yet.</div>';
            return;
        }
        
        // Apply filters
        const filteredIssues = this.applyFilters(this.issues);
        
        if (filteredIssues.length === 0) {
            container.innerHTML = '<div class="no-issues">No issues match the current filters.</div>';
            return;
        }
        
        // Create cards for each issue
        filteredIssues.forEach(issue => {
            const card = this.createIssueCard(issue);
            container.appendChild(card);
        });
        
        // Add summary
        const summary = document.createElement('div');
        summary.className = 'summary';
        summary.innerHTML = `
            <p>Showing ${filteredIssues.length} of ${this.issues.length} issues</p>
            <p>High Risk: ${filteredIssues.filter(i => this.issueData[i.key].isHighRisk).length}</p>
            <p>Stalled: ${filteredIssues.filter(i => this.issueData[i.key].isStalled).length}</p>
            <p>Blocking: ${filteredIssues.filter(i => this.issueData[i.key].isBlocking).length}</p>
            <p>Ticket Churn: ${filteredIssues.filter(i => this.issueData[i.key].isPingPong).length}</p>
            <p>Ticket Churn: ${filteredIssues.filter(i => this.issueData[i.key].isChurn).length}</p>
        `;
        container.appendChild(summary);
    }

    // Add indicator helper method
    addIndicator(container, text, className) {
        const indicator = document.createElement('span');
        indicator.className = `indicator ${className}`;
        indicator.textContent = text;
        container.appendChild(indicator);
    }

    // Add method to analyze issue history for ping-pong behavior
    analyzeStatusChanges(issue) {
        // Get the issue's history if available
        const history = issue.changelog?.histories || [];
        
        // Find status changes in the history
        const statusChanges = [];
        history.forEach(change => {
            const statusItem = change.items.find(item => item.field === 'status');
            if (statusItem) {
                statusChanges.push({
                    date: new Date(change.created),
                    from: statusItem.fromString,
                    to: statusItem.toString
                });
            }
        });
        
        // Sort changes by date
        statusChanges.sort((a, b) => a.date - b.date);
        
        // Calculate ping-pong score
        const pingPongDetails = this.calculatePingPongScore(statusChanges);
        
        return {
            statusChanges,
            ...pingPongDetails
        };
    }

    // Calculate ping-pong score for a given set of status changes
    calculatePingPongScore(statusChanges) {
        // If there are less than 3 changes, there can't be ping-pong
        if (statusChanges.length < 3) {
            return { isPingPong: false, pingPongScore: 0, pingPongTransitions: [] };
        }
        
        const transitions = {};
        const pingPongTransitions = [];
        let pingPongScore = 0;
        
        // Track transitions between statuses
        for (let i = 0; i < statusChanges.length - 1; i++) {
            const fromStatus = statusChanges[i].to;
            const toStatus = statusChanges[i + 1].to;
            const transitionKey = `${fromStatus} -> ${toStatus}`;
            const reverseKey = `${toStatus} -> ${fromStatus}`;
            
            // Count this transition
            transitions[transitionKey] = (transitions[transitionKey] || 0) + 1;
            
            // Check for ping-pong - if we already saw the reverse transition
            if (transitions[reverseKey] && !pingPongTransitions.includes(reverseKey)) {
                pingPongTransitions.push(reverseKey);
                pingPongScore += Math.min(transitions[transitionKey], transitions[reverseKey]);
            }
        }
        
        // An issue is considered ping-pong if it has a score of 2 or more
        const isPingPong = pingPongScore >= 2;
        
        return {
            isPingPong,
            pingPongScore,
            pingPongTransitions
        };
    }

    // Update the analyzeIssue method to include ping-pong detection
    analyzeIssue(issue) {
        // Extract key values
        const assignee = issue.fields.assignee?.displayName || 'Unassigned';
        const status = issue.fields.status?.name || 'Unknown';
        const created = new Date(issue.fields.created);
        const updated = new Date(issue.fields.updated);
        const daysSinceUpdated = Math.floor((Date.now() - updated) / (1000 * 3600 * 24));
        
        // Calculate if the issue is stalled
        const isStalled = daysSinceUpdated > 14;
        
        // Check if high risk based on labels or other criteria
        const labels = issue.fields.labels || [];
        const isHighRisk = labels.some(label => 
            label.toLowerCase().includes('risk') || 
            label.toLowerCase().includes('critical')
        );
        
        // Check if this issue is blocking others
        const blockedBy = issue.fields.issuelinks?.filter(link => 
            link.type.name === 'Blocks' && link.inwardIssue
        ).map(link => link.inwardIssue.key) || [];
        
        const isBlocking = blockedBy.length > 0;
        
        // Analyze status changes for ping-pong behavior
        const statusAnalysis = this.analyzeStatusChanges(issue);
        
        return {
            key: issue.key,
            summary: issue.fields.summary,
            description: issue.fields.description,
            assignee,
            status,
            created,
            updated,
            daysSinceUpdated,
            isStalled,
            isHighRisk,
            isBlocking,
            blockedBy,
            isPingPong: statusAnalysis.isPingPong,
            pingPongScore: statusAnalysis.pingPongScore,
            pingPongTransitions: statusAnalysis.pingPongTransitions,
            statusChanges: statusAnalysis.statusChanges
        };
    }

    // Update initializeApp to include ping-pong filter
    async initializeApp() {
        try {
            // Load configuration (Jira URL and backend settings)
            await this.loadConfig();
            
            // Load aging thresholds from the backend
            await this.loadAgingThresholds();
            
            // Find the Story Point field ID
            await this.findStoryPointFieldId(); 
            
            // Fetch available boards from Jira
            await this.fetchBoards();
        } catch (error) {
            console.error('Error initializing app:', error);
            this.showError('Failed to initialize the application. Please check your connection and try again.');
        }
    }
    
    async loadAgingThresholds() {
        try {
            // Fetch aging thresholds from the backend
            const response = await fetch(`${this.proxyUrl}/aging-thresholds`);
            if (response.ok) {
                const thresholds = await response.json();
                console.log('Loaded aging thresholds from backend:', thresholds);
                
                // Update the risk thresholds with values from backend
                this.riskThresholds = { ...this.riskThresholds, ...thresholds };
                
                // Log the updated thresholds
                console.log('Updated risk thresholds:', this.riskThresholds);
            } else {
                console.warn('Failed to load aging thresholds, using defaults');
            }
        } catch (error) {
            console.error('Error loading aging thresholds:', error);
            console.warn('Using default aging thresholds');
        }
    }
    
    async fetchBoards() {
        try {
            const boardSelect = document.getElementById('boardSelect');
            if (boardSelect) {
                // Show loading state
                boardSelect.innerHTML = '<option value="">Loading boards...</option>';
                boardSelect.disabled = true;
            }
            
            const url = `${this.proxyUrl}${this.proxyEndpoint}/boards`;
            console.log(`Fetching boards from: ${url}`);
            
            const response = await fetch(url);
            console.log('Board fetch response status:', response.status);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Error response from boards endpoint:', errorText);
                const errorData = response.headers.get('Content-Type')?.includes('application/json') ? JSON.parse(errorText) : { error: errorText };
                throw new Error(errorData.error || `Failed to fetch boards: ${response.status}`);
            }
            
            const responseText = await response.text();
            console.log('Board response text (first 100 chars):', responseText.substring(0, 100));
            
            try {
                const data = JSON.parse(responseText);
                const boards = data.boards || [];
                
                console.log(`Loaded ${boards.length} boards from Jira. First 3 boards:`, boards.slice(0, 3));
                
                // Populate board dropdown
                this.populateBoardDropdown(boards);
                
                if (boardSelect) {
                    boardSelect.disabled = false;
                }
            } catch (parseError) {
                console.error('JSON parse error:', parseError);
                console.error('Response was:', responseText);
                throw new Error('Invalid JSON response from server');
            }
        } catch (error) {
            console.error('Error fetching boards:', error);
            this.showError(`Failed to load boards: ${error.message}`);
            
            // Reset the select
            const boardSelect = document.getElementById('boardSelect');
            if (boardSelect) {
                boardSelect.innerHTML = '<option value="">Error loading boards</option>';
                boardSelect.disabled = false;
            }
        }
    }
    
    populateBoardDropdown(boards) {
        const boardSelect = document.getElementById('boardSelect');
        if (!boardSelect) return;
        
        console.log(`Received ${boards.length} boards to populate in dropdown`);
        
        // Clear existing options
        boardSelect.innerHTML = '<option value="">Select a board</option>';
        
        // Group boards by project key for better organization
        const projectGroups = {};
        const ungroupedBoards = [];
        
        // First pass - organize boards by project key
        boards.forEach(board => {
            const projectKey = board.location?.projectKey;
            if (projectKey) {
                if (!projectGroups[projectKey]) {
                    projectGroups[projectKey] = [];
                }
                projectGroups[projectKey].push(board);
            } else {
                ungroupedBoards.push(board);
            }
        });
        
        // Create an option group for each project
        const projectKeys = Object.keys(projectGroups).sort((a, b) => a.localeCompare(b, undefined, {sensitivity: 'base'}));
        
        console.log(`Found ${projectKeys.length} project groups and ${ungroupedBoards.length} ungrouped boards`);
        
        // Create document fragment for better performance with large lists
        const fragment = document.createDocumentFragment();
        
        // Add grouped boards
        projectKeys.forEach(projectKey => {
            const projectBoards = projectGroups[projectKey];
            
            // Sort boards within each project
            projectBoards.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));
            
            // Create optgroup if there are multiple boards in this project
            if (projectBoards.length > 1) {
                const optgroup = document.createElement('optgroup');
                optgroup.label = projectKey;
                
                projectBoards.forEach(board => {
                    const option = document.createElement('option');
                    option.value = projectKey;
                    option.textContent = board.name;
                    option.dataset.boardId = board.id.toString();
                    optgroup.appendChild(option);
                });
                
                fragment.appendChild(optgroup);
            } else if (projectBoards.length === 1) {
                // Single board, no need for optgroup
                const board = projectBoards[0];
                const option = document.createElement('option');
                option.value = projectKey;
                option.textContent = `${projectKey} - ${board.name}`;
                option.dataset.boardId = board.id.toString();
                fragment.appendChild(option);
            }
        });
        
        // Add ungrouped boards (no project key)
        if (ungroupedBoards.length > 0) {
            // Sort ungrouped boards
            ungroupedBoards.sort((a, b) => a.name.localeCompare(b.name, undefined, {sensitivity: 'base'}));
            
            if (projectKeys.length > 0) {
                // Add separator if we already have project groups
                const separator = document.createElement('option');
                separator.disabled = true;
                separator.textContent = '──────────────';
                fragment.appendChild(separator);
            }
            
            // Add each ungrouped board
            ungroupedBoards.forEach(board => {
                const option = document.createElement('option');
                option.value = board.id.toString();
                option.textContent = board.name;
                fragment.appendChild(option);
            });
        }
        
        // Add all options to the select element at once (better performance)
        boardSelect.appendChild(fragment);
        
        console.log(`Populated dropdown with ${boards.length} boards (${projectKeys.length} project groups, ${ungroupedBoards.length} ungrouped)`);
    }

    filterIssues() {
        // Get the current filters
        const showFiltered = document.getElementById('showFiltered').checked;
        const showResolved = document.getElementById('showResolved').checked;
        const showAtRiskOnly = document.getElementById('showAtRiskOnly').checked;
        const showPingPongOnly = document.getElementById('showPingPongOnly').checked;
        const showChurnOnly = document.getElementById('showChurnOnly').checked;
        const textFilter = document.getElementById('textFilter').value.toLowerCase();
        
        // Store filter state
        this.showingAtRiskOnly = showAtRiskOnly;
        this.showingPingPongOnly = showPingPongOnly;
        this.showingChurnOnly = showChurnOnly;
        
        // Log the state of all filters
        console.log('Filter state:', { 
            showFiltered, 
            showResolved, 
            showAtRiskOnly, 
            showPingPongOnly,
            showChurnOnly,
            textFilter
        });
        
        // Filter the issues
        let filteredIssues = [...this.issues];
        
        // Apply text filter
        if (textFilter.length > 0) {
            filteredIssues = filteredIssues.filter(issue => {
                return issue.key.toLowerCase().includes(textFilter) || 
                       issue.fields.summary.toLowerCase().includes(textFilter);
            });
        }
        
        // Filter out "Filtered issues" if needed
        if (!showFiltered) {
            filteredIssues = filteredIssues.filter(issue => {
                return !this.filteredCategoryIssues.includes(issue.key);
            });
        }
        
        // Filter out resolved issues if needed
        if (!showResolved) {
            filteredIssues = filteredIssues.filter(issue => {
                return !issue.fields.status.name.includes('Done') && 
                       !issue.fields.status.name.includes('Closed') && 
                       !issue.fields.status.name.includes('Resolved');
            });
        }
        
        // Filter only at-risk issues if needed
        if (showAtRiskOnly) {
            filteredIssues = filteredIssues.filter(issue => {
                const issueData = this.issueData[issue.key] || {};
                return issueData.isAging || false;
            });
        }
        
        // Filter only ping-pong issues if needed
        if (showPingPongOnly) {
            filteredIssues = filteredIssues.filter(issue => {
                const issueData = this.issueData[issue.key] || {};
                return issueData.isPingPong || false;
            });
            
            // Log how many ping-pong issues were found
            console.log(`Found ${filteredIssues.length} ping-pong issues after filtering`);
        }
        
        // Filter only churn issues if needed
        if (showChurnOnly) {
            filteredIssues = filteredIssues.filter(issue => {
                const issueData = this.issueData[issue.key] || {};
                // Debug log for churn issues
                console.log(`Checking issue ${issue.key} for churn: isChurn=${issueData.isChurn || false}`);
                return issueData.isChurn || false;
            });
            
            // Log how many churn issues were found
            console.log(`Found ${filteredIssues.length} churn issues after filtering`);
        }
        
        // Update the UI
        this.updateTicketTable(filteredIssues);
        this.updateFilterStats(filteredIssues);
    }

    getStageColor(stage, opacity = 1) {
        const stageColors = {
            'To Do': `rgba(108, 132, 233, ${opacity})`,
            'In Progress': `rgba(54, 179, 126, ${opacity})`,
            'Code Review': `rgba(255, 153, 31, ${opacity})`,
            'QA': `rgba(101, 84, 192, ${opacity})`,
            'Done': `rgba(87, 217, 163, ${opacity})`
        };
        
        return stageColors[stage] || `rgba(120, 120, 120, ${opacity})`;
    }

    renderCycleTimeMetrics(container) {
        console.log('renderCycleTimeMetrics called');
        
        try {
            if (!this.resolutionMetrics || !this.resolutionMetrics.cycle_time_metrics || Object.keys(this.resolutionMetrics.cycle_time_metrics).length === 0) {
                console.warn('No cycle time metrics found');
                container.innerHTML = '<p class="no-data">No cycle time metrics available.</p>';
                return;
            }
            
            const cycleTimeMetrics = this.resolutionMetrics.cycle_time_metrics;
            
            // Create main container with title
            const metricsContainer = document.createElement('div');
            metricsContainer.style.backgroundColor = '#fff';
            metricsContainer.style.padding = '25px';
            metricsContainer.style.borderRadius = '8px';
            metricsContainer.style.boxShadow = '0 2px 10px rgba(0,0,0,0.05)';
            metricsContainer.style.marginBottom = '30px';
            
            const title = document.createElement('h3');
            title.textContent = 'Cycle Time Metrics';
            title.style.fontSize = '20px';
            title.style.fontWeight = 'bold';
            title.style.marginTop = '0';
            title.style.marginBottom = '20px';
            title.style.color = '#172B4D';
            metricsContainer.appendChild(title);
            
            // Add description
            const description = document.createElement('p');
            description.textContent = 'Average time spent between key workflow transitions.';
            description.style.fontSize = '14px';
            description.style.color = '#666';
            description.style.marginBottom = '25px';
            metricsContainer.appendChild(description);
            
            // Create grid for metrics
            const gridContainer = document.createElement('div');
            gridContainer.style.display = 'grid';
            gridContainer.style.gridTemplateColumns = 'repeat(auto-fill, minmax(400px, 1fr))';
            gridContainer.style.gap = '25px';
            
            // Get all the cycle times and sort by value to show most important first
            const cycleTimeEntries = Object.entries(cycleTimeMetrics);
            cycleTimeEntries.sort((a, b) => b[1].avg_hours - a[1].avg_hours);
            
            cycleTimeEntries.forEach(([key, data]) => {
                const transitionNames = key.split(' → ');
                const fromState = transitionNames[0];
                const toState = transitionNames[1];
                
                // Create card for this transition
                const card = document.createElement('div');
                card.style.backgroundColor = '#f7f8f9';
                card.style.padding = '20px';
                card.style.borderRadius = '8px';
                card.style.border = '1px solid #e0e0e0';
                
                // Create header with icons
                const header = document.createElement('div');
                header.style.display = 'flex';
                header.style.alignItems = 'center';
                header.style.marginBottom = '15px';
                
                // From state with icon
                const fromStateDiv = document.createElement('div');
                fromStateDiv.textContent = fromState;
                fromStateDiv.style.fontWeight = 'bold';
                fromStateDiv.style.fontSize = '16px';
                fromStateDiv.style.padding = '8px 12px';
                fromStateDiv.style.backgroundColor = this.getStatusColor(fromState, 0.15);
                fromStateDiv.style.color = this.getStatusColor(fromState);
                fromStateDiv.style.borderRadius = '5px';
                header.appendChild(fromStateDiv);
                
                // Arrow icon
                const arrow = document.createElement('div');
                arrow.innerHTML = '&#8594;'; // Right arrow
                arrow.style.margin = '0 15px';
                arrow.style.fontSize = '20px';
                arrow.style.color = '#6B778C';
                header.appendChild(arrow);
                
                // To state with icon
                const toStateDiv = document.createElement('div');
                toStateDiv.textContent = toState;
                toStateDiv.style.fontWeight = 'bold';
                toStateDiv.style.fontSize = '16px';
                toStateDiv.style.padding = '8px 12px';
                toStateDiv.style.backgroundColor = this.getStatusColor(toState, 0.15);
                toStateDiv.style.color = this.getStatusColor(toState);
                toStateDiv.style.borderRadius = '5px';
                header.appendChild(toStateDiv);
                
                card.appendChild(header);
                
                // Add metrics
                const metrics = document.createElement('div');
                metrics.style.marginTop = '20px';
                
                // Average time
                const avgTimeRow = document.createElement('div');
                avgTimeRow.style.display = 'flex';
                avgTimeRow.style.justifyContent = 'space-between';
                avgTimeRow.style.marginBottom = '15px';
                
                const avgLabel = document.createElement('div');
                avgLabel.textContent = 'Average Duration:';
                avgLabel.style.fontSize = '15px';
                avgLabel.style.color = '#172B4D';
                avgTimeRow.appendChild(avgLabel);
                
                const avgValue = document.createElement('div');
                avgValue.textContent = this.formatDuration(data.avg_hours);
                avgValue.style.fontWeight = 'bold';
                avgValue.style.fontSize = '18px';
                avgValue.style.color = '#172B4D';
                avgTimeRow.appendChild(avgValue);
                
                metrics.appendChild(avgTimeRow);
                
                // Median time if available
                if (data.median_hours !== undefined) {
                    const medianTimeRow = document.createElement('div');
                    medianTimeRow.style.display = 'flex';
                    medianTimeRow.style.justifyContent = 'space-between';
                    medianTimeRow.style.marginBottom = '15px';
                    
                    const medianLabel = document.createElement('div');
                    medianLabel.textContent = 'Median Duration:';
                    medianLabel.style.fontSize = '15px';
                    medianLabel.style.color = '#172B4D';
                    medianTimeRow.appendChild(medianLabel);
                    
                    const medianValue = document.createElement('div');
                    medianValue.textContent = this.formatDuration(data.median_hours);
                    medianValue.style.fontWeight = 'bold';
                    medianValue.style.fontSize = '16px';
                    medianValue.style.color = '#172B4D';
                    medianTimeRow.appendChild(medianValue);
                    
                    metrics.appendChild(medianTimeRow);
                }
                
                // Sample count
                const countRow = document.createElement('div');
                countRow.style.display = 'flex';
                countRow.style.justifyContent = 'space-between';
                countRow.style.marginBottom = '10px';
                
                const countLabel = document.createElement('div');
                countLabel.textContent = 'Tickets Analyzed:';
                countLabel.style.fontSize = '15px';
                countLabel.style.color = '#172B4D';
                countRow.appendChild(countLabel);
                
                const countValue = document.createElement('div');
                countValue.textContent = data.count;
                countValue.style.fontWeight = 'bold';
                countValue.style.fontSize = '16px';
                countValue.style.color = '#172B4D';
                countRow.appendChild(countValue);
                
                metrics.appendChild(countRow);
                
                // Add mini chart/visual if desired
                if (data.percentiles) {
                    const chartContainer = document.createElement('div');
                    chartContainer.style.marginTop = '20px';
                    
                    const chartTitle = document.createElement('div');
                    chartTitle.textContent = 'Percentiles';
                    chartTitle.style.fontSize = '15px';
                    chartTitle.style.fontWeight = 'bold';
                    chartTitle.style.marginBottom = '10px';
                    chartContainer.appendChild(chartTitle);
                    
                    // Create percentile bars
                    const percentiles = [25, 50, 75, 90];
                    const maxPercentileValue = Math.max(...percentiles.map(p => data.percentiles[`p${p}`] || 0));
                    
                    percentiles.forEach(percentile => {
                        if (!data.percentiles[`p${percentile}`]) return;
                        
                        const value = data.percentiles[`p${percentile}`];
                        const percentage = (value / maxPercentileValue) * 100;
                        
                        const pRow = document.createElement('div');
                        pRow.style.display = 'flex';
                        pRow.style.alignItems = 'center';
                        pRow.style.marginBottom = '10px';
                        
                        const pLabel = document.createElement('div');
                        pLabel.style.width = '50px';
                        pLabel.style.fontSize = '14px';
                        pLabel.style.color = '#505F79';
                        pLabel.textContent = `P${percentile}:`;
                        pRow.appendChild(pLabel);
                        
                        const pBarContainer = document.createElement('div');
                        pBarContainer.style.flex = '1';
                        pBarContainer.style.height = '14px';
                        pBarContainer.style.backgroundColor = '#f0f0f0';
                        pBarContainer.style.borderRadius = '7px';
                        pBarContainer.style.overflow = 'hidden';
                        pBarContainer.style.margin = '0 10px';
                        
                        const pBar = document.createElement('div');
                        pBar.style.height = '100%';
                        pBar.style.width = `${percentage}%`;
                        pBar.style.backgroundColor = this.getPercentileColor(percentile);
                        pBarContainer.appendChild(pBar);
                        
                        pRow.appendChild(pBarContainer);
                        
                        const pValue = document.createElement('div');
                        pValue.style.width = '100px';
                        pValue.style.fontSize = '14px';
                        pValue.style.fontWeight = 'bold';
                        pValue.style.textAlign = 'right';
                        pValue.textContent = this.formatDuration(value);
                        pRow.appendChild(pValue);
                        
                        chartContainer.appendChild(pRow);
                    });
                    
                    metrics.appendChild(chartContainer);
                }
                
                card.appendChild(metrics);
                gridContainer.appendChild(card);
            });
            
            metricsContainer.appendChild(gridContainer);
            container.appendChild(metricsContainer);
            
        } catch (error) {
            console.error('Error rendering cycle time metrics:', error);
            container.innerHTML = `<p class="no-data">Error rendering cycle time metrics: ${error.message}</p>`;
        }
    }
    
    getPercentileColor(percentile) {
        switch(percentile) {
            case 25: return '#36B37E'; // Green
            case 50: return '#00B8D9'; // Blue
            case 75: return '#FFAB00'; // Orange
            case 90: return '#FF5630'; // Red
            default: return '#6554C0'; // Purple
        }
    }

    async findStoryPointFieldId() {
        console.log('Attempting to find Story Point field ID...');
        try {
            const response = await fetch(`${this.proxyUrl}${this.proxyEndpoint}/field`);
            if (!response.ok) {
                throw new Error(`Failed to fetch fields: ${response.status} ${response.statusText}`);
            }
            
            const fields = await response.json();
            console.log(`Received ${fields.length} fields from Jira API`);

            // Common names for the Story Points field
            const commonNames = ['Story Points', 'Story Point Estimate'];
            let foundField = null;

            for (const field of fields) {
                if (commonNames.some(name => field.name.toLowerCase() === name.toLowerCase())) {
                    foundField = field;
                    break;
                }
            }

            if (foundField) {
                this.storyPointFieldId = foundField.id;
                console.log(`Found Story Point field: '${foundField.name}' with ID: ${this.storyPointFieldId}`);
            } else {
                console.warn('Could not automatically find Story Points field ID using common names.');
                this.showError('Could not find Story Points field. Velocity calculation will be unavailable.');
            }

        } catch (error) {
            console.error('Error fetching Jira fields:', error);
            this.showError(`Failed to fetch field definitions: ${error.message}. Velocity calculation unavailable.`);
            this.storyPointFieldId = null; // Ensure it's null on error
        }
    }
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new JiraMetrics();
}); 

