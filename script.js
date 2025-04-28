class JiraMetrics {
    constructor() {
        this.jiraUrl = '';
        this.proxyUrl = 'http://localhost:5000';
        this.proxyEndpoint = '/proxy';
        this.selectedBoard = '';
        this.selectedSprint = '';
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
        this.showingPingPongOnly = false;
        this.pingPongThreshold = 3; // Minimum number of status changes to consider for ping-pong
        this.filters = {
            highRisk: false,
            stalled: false,
            blocking: false,
            pingPong: false
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
        document.getElementById('connectBtn').addEventListener('click', () => {
            console.log("Connect button clicked - refreshing data");
            this.fetchJiraData();
        });
        
        // Add event listener for board selection to load sprints
        const boardSelect = document.getElementById('boardSelect');
        if (boardSelect) {
            boardSelect.addEventListener('change', () => {
                this.selectedBoard = boardSelect.value;
                console.log('Selected board:', this.selectedBoard);
                
                // Load sprints for the selected board
                if (this.selectedBoard) {
                    this.fetchSprintsForBoard(this.selectedBoard);
                } else {
                    // Clear sprints when no board is selected
                    this.populateSprintDropdown([]);
                }
            });
        }
        
        // Add event listener for the refresh button
        const refreshBtn = document.getElementById('refreshBtn');
        if (refreshBtn) {
            refreshBtn.addEventListener('click', () => {
                const boardSelect = document.getElementById('boardSelect');
                if (boardSelect) {
                    this.selectedBoard = boardSelect.value;
                    console.log('Selected board:', this.selectedBoard);
                }
                
                const sprintSelect = document.getElementById('sprintSelect');
                if (sprintSelect) {
                    this.selectedSprint = sprintSelect.value;
                    console.log('Selected sprint:', this.selectedSprint);
                }
                
                console.log("Refresh button clicked - will load tickets with author and assignee data");
                this.fetchJiraData();
            });
        }
        
        // Add event listener for at-risk only checkbox
        const atRiskOnlyCheckbox = document.getElementById('atRiskOnlyCheckbox');
        if (atRiskOnlyCheckbox) {
            atRiskOnlyCheckbox.addEventListener('change', () => {
                this.showingAtRiskOnly = atRiskOnlyCheckbox.checked;
                console.log('Show only aging tickets:', this.showingAtRiskOnly);
                
                // Update the table without re-fetching data
                this.updateDisplayedTickets();
            });
        }
        
        // Add event listener for ping-pong only checkbox
        const pingPongOnlyCheckbox = document.getElementById('pingPongOnlyCheckbox');
        if (pingPongOnlyCheckbox) {
            pingPongOnlyCheckbox.addEventListener('change', () => {
                this.showingPingPongOnly = pingPongOnlyCheckbox.checked;
                console.log('Show only ping-pong tickets:', this.showingPingPongOnly);
                
                // Update the table without re-fetching data
                this.updateDisplayedTickets();
            });
        }
        
        // Add event listeners for table header sorting
        document.querySelectorAll('th[data-sort]').forEach(header => {
            header.addEventListener('click', () => {
                const column = header.dataset.sort;
                this.sortTickets(column);
            });
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
            if (sprintSelect) {
                // Show loading state
                this.populateSprintDropdown([{ id: '', name: 'Loading sprints...' }]);
                sprintSelect.disabled = true;
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
            
            // Populate sprint dropdown with any message returned from the server
            this.populateSprintDropdown(this.sprints, data.message);
            
            // Select the most recent sprint by default, only if we have sprints
            if (this.sprints.length > 0) {
                try {
                    this.selectedSprint = this.sprints[0].id.toString();
                    
                    if (sprintSelect && this.selectedSprint) {
                        sprintSelect.value = this.selectedSprint;
                        console.log('Auto-selected most recent sprint:', this.sprints[0].name);
                    }
                } catch (error) {
                    console.error('Error selecting default sprint:', error);
                }
            }
            
            if (sprintSelect) {
                sprintSelect.disabled = false;
            }
        } catch (error) {
            console.error('Error fetching sprints:', error);
            this.showError(`Failed to load sprints: ${error.message}`);
            
            // Reset sprint dropdown with error message
            this.populateSprintDropdown([{ id: '', name: `Error: ${error.message}` }]);
            
            if (sprintSelect) {
                sprintSelect.disabled = false;
            }
        }
    }
    
    populateSprintDropdown(sprints, message = null) {
        const sprintSelect = document.getElementById('sprintSelect');
        if (!sprintSelect) return;
        
        // Clear current options
        sprintSelect.innerHTML = '';
        
        // Add "All Sprints" option
        const allOption = document.createElement('option');
        allOption.value = '';
        allOption.textContent = 'All Sprints';
        sprintSelect.appendChild(allOption);
        
        // If we have a message but no sprints, show the message in the dropdown
        if (message && (!sprints || sprints.length === 0)) {
            allOption.textContent = message;
            // Add a help text under the dropdown
            const helpText = document.createElement('div');
            helpText.style.color = '#666';
            helpText.style.fontSize = '12px';
            helpText.style.marginTop = '5px';
            helpText.textContent = 'Note: Some boards may not use sprints or have no sprints configured.';
            
            const sprintContainer = sprintSelect.parentElement;
            if (sprintContainer) {
                // Remove any existing help text
                const existingHelp = sprintContainer.querySelector('.sprint-help');
                if (existingHelp) {
                    existingHelp.remove();
                }
                
                helpText.className = 'sprint-help';
                sprintContainer.appendChild(helpText);
            }
            return;
        }
        
        // Ensure sprints is an array to avoid errors
        const sprintsArray = Array.isArray(sprints) ? sprints : [];
        
        // Add sprints to dropdown
        sprintsArray.forEach(sprint => {
            if (!sprint || sprint.id === '') {
                // For loading or error messages
                allOption.textContent = sprint ? sprint.name : 'Error loading sprints';
                return;
            }
            
            try {
                const option = document.createElement('option');
                option.value = sprint.id ? sprint.id.toString() : '';
                
                // Format the sprint name with its state and board if available
                let sprintName = sprint.name || 'Unnamed Sprint';
                
                // Add state
                if (sprint.state === 'active') {
                    sprintName += ' (Active)';
                } else if (sprint.state === 'future') {
                    sprintName += ' (Future)';
                } else if (sprint.state === 'closed') {
                    sprintName += ' (Closed)';
                }
                
                // Add board name if there are multiple boards
                if (sprint.boardName) {
                    sprintName += ` [${sprint.boardName}]`;
                }
                
                option.textContent = sprintName;
                sprintSelect.appendChild(option);
            } catch (error) {
                console.error('Error adding sprint option:', error, sprint);
            }
        });
        
        // If we have multiple boards with sprints, add a help text
        if (sprintsArray.some(s => s && s.boardName)) {
            const helpText = document.createElement('div');
            helpText.style.color = '#666';
            helpText.style.fontSize = '12px';
            helpText.style.marginTop = '5px';
            helpText.textContent = 'Note: This project has multiple boards with sprints.';
            
            const sprintContainer = sprintSelect.parentElement;
            if (sprintContainer) {
                // Remove any existing help text
                const existingHelp = sprintContainer.querySelector('.sprint-help');
                if (existingHelp) {
                    existingHelp.remove();
                }
                
                helpText.className = 'sprint-help';
                sprintContainer.appendChild(helpText);
            }
        }
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
        if (!this.selectedBoard) {
            this.showError('Please select a board first');
            this.showBoardSelectionMessage();
            return;
        }
        
        // Reset the issue data store
        this.issueData = {};

        // First, try to fetch a simple endpoint to test the connection
        try {
            const testResponse = await fetch(`${this.proxyUrl}${this.proxyEndpoint}/serverInfo`);

            if (!testResponse.ok) {
                const errorData = await testResponse.json();
                throw new Error(errorData.error || `Jira API returned ${testResponse.status}: ${testResponse.statusText}`);
            }
            
            const testData = await testResponse.json();
            console.log('Successfully connected to Jira:', testData);
        } catch (error) {
            if (error.message.includes('Failed to fetch')) {
                throw new Error('Could not connect to Jira. Please make sure the proxy server is running.');
            }
            this.showError(`Connection test failed: ${error.message}`);
            console.error('Connection test failed:', error);
            return;
        }

        // If test succeeds, fetch the actual data
        try {
            // Build the JQL query with filters
            let jqlParts = [];
            
            // Add board/project filter if selected
            if (this.selectedBoard) {
                jqlParts.push(`project = ${this.selectedBoard}`);
                console.log('Filtering by board:', this.selectedBoard);
            }
            
            // Add sprint filter if selected
            if (this.selectedSprint) {
                jqlParts.push(`sprint = ${this.selectedSprint}`);
                console.log('Filtering by sprint ID:', this.selectedSprint);
                
                // Find the sprint name for logging
                const sprint = this.sprints.find(s => s.id.toString() === this.selectedSprint);
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
            
            this.updateMetrics(this.issues);
            this.updateTicketTable(this.issues);
        } catch (error) {
            this.showError(`Failed to fetch Jira data: ${error.message}`);
            console.error('Failed to fetch Jira data:', error);
        }
    }
    
    async fetchResolutionMetrics() {
        try {
            // Construct query parameters based on current filters
            let queryParams = new URLSearchParams();
            
            // Add JQL for resolved issues only
            let jql = "resolution is not EMPTY ORDER BY created DESC";
            
            // Add board/project filter if selected
            if (this.selectedBoard) {
                queryParams.append('board', this.selectedBoard);
            }
            
            // Add sprint filter if selected
            if (this.selectedSprint) {
                jql = `sprint = ${this.selectedSprint} AND ${jql}`;
            }
            
            queryParams.append('jql', jql);
            
            const url = `${this.proxyUrl}${this.proxyEndpoint}/resolution-metrics?${queryParams.toString()}`;
            console.log('Fetching resolution metrics from:', url);
            
            const response = await fetch(url);
            
            if (!response.ok) {
                const errorText = await response.text();
                console.error('Resolution metrics response error:', response.status, errorText);
                throw new Error(`Failed to fetch resolution metrics: ${response.status} ${response.statusText}`);
            }
            
            const data = await response.json();
            console.log('Resolution metrics data:', data);
            this.resolutionMetrics = data;
            
            // Render the resolution phase chart
            this.renderPhaseResolutionChart();
            
        } catch (error) {
            console.error('Error fetching resolution metrics:', error);
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
        
        if (!this.resolutionMetrics || !this.resolutionMetrics.cycle_times) {
            console.warn('No cycle time metrics available', this.resolutionMetrics);
            chartContainer.innerHTML = '<p class="no-data">No cycle time data available. Select a board and load tickets to see analysis.</p>';
            return;
        }
        
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
                
            } catch (error) {
                console.error(`Error analyzing risk for ${issue.key}:`, error);
            }
        });
        
        // Wait for all the analysis to complete
        await Promise.all(promises);
        
        // Count aging tickets
        const atRiskCount = Object.values(this.issueData).filter(data => data.isAging).length;
        const pingPongCount = Object.values(this.issueData).filter(data => data.isPingPong).length;
        console.log(`Analysis complete: Found ${atRiskCount} aging tickets and ${pingPongCount} ping-pong tickets`);
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

    updateMetrics(issues) {
        // Total tickets
        document.getElementById('totalTickets').textContent = issues.length;

        // Calculate average resolution time
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
        
        // Count issues in each risk category and by status
        const riskCounts = {
            high: 0,
            medium: 0
        };
        
        // Count aging tickets by status category
        const statusCounts = {
            'In Progress': 0,
            'In Review': 0,
            'In QA': 0
        };
        
        // List of active statuses we care about for aging
        const activeStatuses = ['In Progress', 'In Review', 'In QA'];
        
        // Calculate the count for each risk level and status
        issues.forEach(issue => {
            const issueData = this.issueData[issue.key] || {};
            const riskLevel = issueData.riskLevel || 'none';
            const statusCategory = issueData.currentStatusCategory;
            
            // Only count by risk level if it's an active status that can age
            if (statusCategory && activeStatuses.includes(statusCategory) && (riskLevel === 'high' || riskLevel === 'medium')) {
                riskCounts[riskLevel]++;
                
                // Count by status category
                if (issueData.isAging) {
                    statusCounts[statusCategory] = (statusCounts[statusCategory] || 0) + 1;
                }
            }
        });
        
        // Calculate the total aging tickets (high + medium)
        const totalAging = riskCounts.high + riskCounts.medium;
        
        // Create info section about thresholds
        let thresholdInfo = `
            <div style="margin-top: 10px; font-size: 0.8em; color: #666; padding: 5px; border-radius: 3px; background-color: #f5f5f5;">
                <div style="margin-bottom: 5px; font-weight: bold;">Current thresholds:</div>
        `;
        
        for (const status of activeStatuses) {
            const hours = this.riskThresholds[status] || 72;
            const days = Math.round(hours / 24 * 10) / 10;
            thresholdInfo += `<div>${status}: ${hours} hours (${days} days)</div>`;
        }
        
        thresholdInfo += `
                <div style="margin-top: 5px; font-style: italic;">
                    High risk = 2× threshold, Medium risk = 1× threshold
                </div>
            </div>
        `;
        
        if (totalAging === 0) {
            riskSummaryElement.innerHTML = `
                <div style="text-align: center; padding: 20px;">No aging tickets</div>
                ${thresholdInfo}
            `;
            return;
        }
        
        // Generate HTML for the risk summary
        let summaryHTML = `
            <div style="margin: 10px 0;">
                <div style="margin-bottom: 10px; font-weight: bold;">
                    ${totalAging} aging ticket${totalAging !== 1 ? 's' : ''} (${Math.round(totalAging / issues.length * 100)}% of total)
                </div>
        `;
        
        // Show aging tickets by risk level
        if (riskCounts.high > 0) {
            const percentage = Math.round(riskCounts.high / totalAging * 100);
            summaryHTML += `
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <div style="width: 70px; font-weight: bold; color: #FF5630;">High:</div>
                    <div style="background-color: #eee; height: 15px; flex-grow: 1; border-radius: 3px; overflow: hidden;">
                        <div style="width: ${percentage}%; background-color: #FF5630; height: 100%;"></div>
                    </div>
                    <div style="width: 30px; text-align: right; margin-left: 5px;">${riskCounts.high}</div>
                </div>
            `;
        }
        
        if (riskCounts.medium > 0) {
            const percentage = Math.round(riskCounts.medium / totalAging * 100);
            summaryHTML += `
                <div style="display: flex; align-items: center; margin-bottom: 10px;">
                    <div style="width: 70px; font-weight: bold; color: #FFAB00;">Medium:</div>
                    <div style="background-color: #eee; height: 15px; flex-grow: 1; border-radius: 3px; overflow: hidden;">
                        <div style="width: ${percentage}%; background-color: #FFAB00; height: 100%;"></div>
                    </div>
                    <div style="width: 30px; text-align: right; margin-left: 5px;">${riskCounts.medium}</div>
                </div>
            `;
        }
        
        // Add section heading for status breakdown
        summaryHTML += `
            <div style="margin-top: 15px; margin-bottom: 8px; font-weight: bold; border-top: 1px solid #ddd; padding-top: 10px;">
                Aging tickets by status:
            </div>
        `;
        
        // Show aging tickets by status category
        const statusColors = {
            'In Progress': '#0052CC',  // Blue
            'In Review': '#6554C0',    // Purple
            'In QA': '#00875A'         // Green
        };
        
        for (const [status, count] of Object.entries(statusCounts)) {
            if (count > 0) {
                const percentage = Math.round(count / totalAging * 100);
                const color = statusColors[status] || '#999999';
                
                summaryHTML += `
                    <div style="display: flex; align-items: center; margin-bottom: 5px;">
                        <div style="width: 90px; font-weight: bold; color: ${color};">${status}:</div>
                        <div style="background-color: #eee; height: 15px; flex-grow: 1; border-radius: 3px; overflow: hidden;">
                            <div style="width: ${percentage}%; background-color: ${color}; height: 100%;"></div>
                        </div>
                        <div style="width: 30px; text-align: right; margin-left: 5px;">${count}</div>
                    </div>
                `;
            }
        }
        
        // Add threshold info at the bottom
        summaryHTML += thresholdInfo;
        summaryHTML += '</div>';
        riskSummaryElement.innerHTML = summaryHTML;
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
                    ${this.showingAtRiskOnly && this.showingPingPongOnly ? 'No aging ping-pong tickets found' : 
                     this.showingAtRiskOnly ? 'No aging tickets found' :
                     this.showingPingPongOnly ? 'No ping-pong tickets found' : 'No tickets found'}
                </td>
            `;
            tbody.appendChild(emptyRow);
            return;
        }

        issues.forEach(issue => {
            const row = document.createElement('tr');
            
            // Check if this issue is aging
            const issueData = this.issueData[issue.key] || {};
            const isAging = issueData.isAging || false;
            const riskLevel = issueData.riskLevel || 'none';
            const timeInStatus = issueData.timeInStatus || '';
            const isPingPong = issueData.isPingPong || false;
            const pingPongScore = issueData.pingPongScore || 0;
            
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
            if (isPingPong) {
                row.style.border = '2px dashed #6554C0'; // Purple border for ping-pong tickets
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
                    ${isPingPong ? `
                        <span class="ping-pong-badge" style="display: inline-block; padding: 2px 6px; border-radius: 3px; font-size: 0.8em; font-weight: bold; color: white; background-color: #6554C0;">
                            ${pingPongScore}
                        </span>
                    ` : ''}
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
        
        if (!modal || !modalTitle || !statusDurationChart || !statusDurationDetails || !statusTimeline) {
            console.error('Modal elements not found');
            return;
        }
        
        // Set loading state
        modalTitle.textContent = `Analyzing Status Timeline for ${issueKey}`;
        statusDurationChart.innerHTML = '<div style="text-align: center; padding: 20px;">Loading status data...</div>';
        statusDurationDetails.innerHTML = '';
        statusTimeline.innerHTML = '';
        if (pingPongSection) pingPongSection.innerHTML = '';
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
        
        // Get ping-pong data - check several possible sources
        let pingPongScore = 0;
        let transitions = [];
        
        // First, check if we have data from the backend's ping_pong_metrics
        if (data.ping_pong_metrics && data.ping_pong_metrics.tickets_with_scores && data.ping_pong_metrics.tickets_with_scores[issueKey]) {
            const pingPongData = data.ping_pong_metrics.tickets_with_scores[issueKey];
            pingPongScore = pingPongData.score;
            transitions = pingPongData.transitions || [];
        }
        // Second, check if analyzePingPongTransitions already processed this issue
        else if (this.issueData[issueKey] && this.issueData[issueKey].pingPongScore !== undefined) {
            pingPongScore = this.issueData[issueKey].pingPongScore;
            transitions = this.issueData[issueKey].statusTransitions || [];
        }
        // Otherwise, we need to process the statusChanges to find ping-pongs
        else if (data.status_changes && data.status_changes.length > 0) {
            // Process the status changes to calculate ping-pong score
            // Create a temporary object to hold the data
            const tempIssue = { key: issueKey };
            this.analyzePingPongTransitions(tempIssue, data);
            
            // Now we should have the ping-pong data
            if (this.issueData[issueKey]) {
                pingPongScore = this.issueData[issueKey].pingPongScore || 0;
                transitions = this.issueData[issueKey].statusTransitions || [];
            }
        }
        
        // Show ping-pong information
        this.renderPingPongAnalysis(pingPongSection, pingPongScore, transitions);
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
    
    renderPingPongAnalysis(container, pingPongScore, transitions) {
        if (!transitions || Object.keys(transitions).length === 0) {
            container.innerHTML = '';
            return;
        }
        
        const isPingPong = pingPongScore >= this.pingPongThreshold;
        
        let html = `
            <div style="margin-top: 20px; border-radius: 5px; border: 1px solid #dfe1e6; overflow: hidden; max-height: 500px; display: flex; flex-direction: column;">
                <div style="padding: 15px; background-color: ${isPingPong ? '#EAE6FF' : '#F4F5F7'}; border-bottom: 1px solid #dfe1e6; flex-shrink: 0;">
                    <h3 style="margin: 0; color: ${isPingPong ? '#6554C0' : '#172B4D'};">Status Back-and-Forth Analysis</h3>
                </div>
                
                <div style="padding: 15px; overflow-y: auto; flex-grow: 1;">
                    ${isPingPong ? `
                        <div style="margin-bottom: 15px; padding: 10px; background-color: #F0F0FF; border-radius: 3px; border-left: 3px solid #6554C0; flex-shrink: 0;">
                            <span style="font-weight: bold; color: #6554C0;">⚠️ This ticket has a high amount of back-and-forth movement between statuses.</span>
                        </div>
                    ` : ''}
                    
                    <div style="margin-bottom: 15px; flex-shrink: 0;">
                        <div style="font-size: 16px; margin-bottom: 5px;"><strong>Ping-pong score:</strong> 
                            <span style="display: inline-block; padding: 2px 10px; background-color: ${
                                pingPongScore >= this.pingPongThreshold ? '#6554C0' : 
                                pingPongScore >= this.pingPongThreshold/2 ? '#00B8D9' : '#DFE1E6'
                            }; color: ${pingPongScore >= this.pingPongThreshold/2 ? 'white' : '#172B4D'}; border-radius: 10px; font-weight: bold;">
                                ${pingPongScore}
                            </span>
                        </div>
                        <div style="font-size: 13px; color: #5E6C84;">
                            Scores of ${this.pingPongThreshold} or higher indicate problematic back-and-forth movement.
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
                        <p><strong>About ping-pong analysis:</strong> This analysis detects when a ticket moves backward in the workflow, counting each backward movement as 1 point.</p>
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
            { id: 'filter-ping-pong', label: 'Ping-Pong', filter: 'pingPong' },
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
            <p>Ping-Pong: ${filteredIssues.filter(i => this.issueData[i.key].isPingPong).length}</p>
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
}

// Initialize the application
document.addEventListener('DOMContentLoaded', () => {
    new JiraMetrics();
}); 

