/**
 * Workflow Canvas - Visual workflow builder for MCP Connect
 */

export class WorkflowNode {
  constructor(id, type, x, y) {
    this.id = id;
    this.type = type;
    this.x = x;
    this.y = y;
    this.width = 160;
    this.height = 80;
    this.config = this.getDefaultConfig(type);
    this.inputs = type === 'tool' || type === 'prompt' ? 1 : type === 'parallel' ? 3 : 1;
    this.outputs = type === 'condition' ? 2 : 1;
  }

  getDefaultConfig(type) {
    const configs = {
      tool: { toolName: '', parameters: {} },
      prompt: { template: '', variables: [] },
      resource: { uri: '', type: 'file' },
      parallel: { branches: 2 },
      condition: { expression: '', trueLabel: 'Yes', falseLabel: 'No' },
      sampling: { strategy: 'temperature', temperature: 0.7, maxTokens: 1000 }
    };
    return configs[type] || {};
  }

  getIcon() {
    const icons = {
      tool: '🔧',
      prompt: '💬',
      resource: '📄',
      parallel: '⚡',
      condition: '🔀',
      sampling: '🎲'
    };
    return icons[this.type] || '📦';
  }

  getColor() {
    const colors = {
      tool: '#6366f1',
      prompt: '#8b5cf6',
      resource: '#22c55e',
      parallel: '#f59e0b',
      condition: '#3b82f6',
      sampling: '#ec4899'
    };
    return colors[this.type] || '#71717a';
  }
}

export class WorkflowConnection {
  constructor(id, fromNode, fromPort, toNode, toPort) {
    this.id = id;
    this.fromNode = fromNode;
    this.fromPort = fromPort;
    this.toNode = toNode;
    this.toPort = toPort;
  }

  getPath(nodes) {
    const from = nodes.find(n => n.id === this.fromNode);
    const to = nodes.find(n => n.id === this.toNode);

    if (!from || !to) return '';

    const x1 = from.x + from.width;
    const y1 = from.y + from.height / 2 + (this.fromPort * 20);
    const x2 = to.x;
    const y2 = to.y + to.height / 2 + (this.toPort * 20);

    const dx = x2 - x1;
    const cx1 = x1 + Math.max(dx * 0.5, 50);
    const cx2 = x2 - Math.max(dx * 0.5, 50);

    return `M ${x1},${y1} C ${cx1},${y1} ${cx2},${y2} ${x2},${y2}`;
  }
}

export class WorkflowState {
  constructor() {
    this.nodes = [];
    this.connections = [];
    this.selectedNode = null;
    this.selectedConnection = null;
    this.nextNodeId = 1;
    this.nextConnectionId = 1;
  }

  addNode(node) {
    this.nodes.push(node);
    return node;
  }

  removeNode(nodeId) {
    this.nodes = this.nodes.filter(n => n.id !== nodeId);
    this.connections = this.connections.filter(
      c => c.fromNode !== nodeId && c.toNode !== nodeId
    );
  }

  addConnection(connection) {
    this.connections.push(connection);
    return connection;
  }

  removeConnection(connectionId) {
    this.connections = this.connections.filter(c => c.id !== connectionId);
  }

  getNode(nodeId) {
    return this.nodes.find(n => n.id === nodeId);
  }

  clear() {
    this.nodes = [];
    this.connections = [];
    this.selectedNode = null;
    this.selectedConnection = null;
    this.nextNodeId = 1;
    this.nextConnectionId = 1;
  }
}

export class WorkflowCanvas {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.nodesGroup = document.getElementById('nodes');
    this.connectionsGroup = document.getElementById('connections');
    this.state = new WorkflowState();
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.isPanning = false;
    this.isConnecting = false;
    this.connectionStart = null;
    this.panMode = false;

    this.init();
  }

  init() {
    // Setup drag and drop from palette
    const paletteNodes = document.querySelectorAll('.palette-node');
    paletteNodes.forEach(node => {
      node.addEventListener('dragstart', (e) => {
        e.dataTransfer.setData('nodeType', node.dataset.type);
      });
    });

    this.canvas.addEventListener('dragover', (e) => {
      e.preventDefault();
    });

    this.canvas.addEventListener('drop', (e) => {
      e.preventDefault();
      const nodeType = e.dataTransfer.getData('nodeType');
      if (nodeType) {
        const rect = this.canvas.getBoundingClientRect();
        const x = (e.clientX - rect.left - this.panX) / this.scale;
        const y = (e.clientY - rect.top - this.panY) / this.scale;
        this.addNodeAt(nodeType, x, y);
      }
    });

    // Canvas interactions
    this.canvas.addEventListener('mousedown', (e) => this.handleMouseDown(e));
    this.canvas.addEventListener('mousemove', (e) => this.handleMouseMove(e));
    this.canvas.addEventListener('mouseup', (e) => this.handleMouseUp(e));
    this.canvas.addEventListener('wheel', (e) => this.handleWheel(e), { passive: false });

    // Keyboard shortcuts
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (this.state.selectedNode) {
          this.deleteNode(this.state.selectedNode.id);
        }
      }
    });
  }

  addNodeAt(type, x, y) {
    const node = new WorkflowNode(`node_${this.state.nextNodeId++}`, type, x, y);
    this.state.addNode(node);
    this.renderNode(node);
    this.selectNode(node);
  }

  renderNode(node) {
    const g = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    g.id = node.id;
    g.setAttribute('class', 'workflow-node');
    g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    g.style.cursor = 'move';

    // Background
    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('width', node.width);
    rect.setAttribute('height', node.height);
    rect.setAttribute('rx', 8);
    rect.setAttribute('fill', '#1a1a24');
    rect.setAttribute('stroke', node.getColor());
    rect.setAttribute('stroke-width', 2);
    rect.setAttribute('filter', 'url(#shadow)');
    g.appendChild(rect);

    // Icon
    const icon = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    icon.setAttribute('x', 20);
    icon.setAttribute('y', 35);
    icon.setAttribute('font-size', 24);
    icon.textContent = node.getIcon();
    g.appendChild(icon);

    // Label
    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', 50);
    label.setAttribute('y', 35);
    label.setAttribute('fill', '#f4f4f5');
    label.setAttribute('font-size', 14);
    label.setAttribute('font-weight', 500);
    label.textContent = node.type.charAt(0).toUpperCase() + node.type.slice(1);
    g.appendChild(label);

    // Type
    const typeText = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    typeText.setAttribute('x', 50);
    typeText.setAttribute('y', 52);
    typeText.setAttribute('fill', '#a1a1aa');
    typeText.setAttribute('font-size', 11);
    typeText.textContent = node.id;
    g.appendChild(typeText);

    // Output port
    const outputPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    outputPort.setAttribute('cx', node.width);
    outputPort.setAttribute('cy', node.height / 2);
    outputPort.setAttribute('r', 6);
    outputPort.setAttribute('fill', node.getColor());
    outputPort.setAttribute('stroke', '#f4f4f5');
    outputPort.setAttribute('stroke-width', 2);
    outputPort.setAttribute('class', 'output-port');
    outputPort.style.cursor = 'crosshair';
    g.appendChild(outputPort);

    // Input port
    const inputPort = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    inputPort.setAttribute('cx', 0);
    inputPort.setAttribute('cy', node.height / 2);
    inputPort.setAttribute('r', 6);
    inputPort.setAttribute('fill', node.getColor());
    inputPort.setAttribute('stroke', '#f4f4f5');
    inputPort.setAttribute('stroke-width', 2);
    inputPort.setAttribute('class', 'input-port');
    inputPort.style.cursor = 'crosshair';
    g.appendChild(inputPort);

    // Event handlers
    g.addEventListener('mousedown', (e) => this.handleNodeMouseDown(e, node));
    outputPort.addEventListener('mousedown', (e) => this.handlePortMouseDown(e, node, 'output'));
    inputPort.addEventListener('mousedown', (e) => this.handlePortMouseDown(e, node, 'input'));

    this.nodesGroup.appendChild(g);
  }

  renderConnection(connection) {
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.id = connection.id;
    path.setAttribute('d', connection.getPath(this.state.nodes));
    path.setAttribute('stroke', '#6366f1');
    path.setAttribute('stroke-width', 2);
    path.setAttribute('fill', 'none');
    path.setAttribute('marker-end', 'url(#arrowhead)');
    path.style.cursor = 'pointer';

    path.addEventListener('click', () => {
      this.state.selectedConnection = connection;
    });

    this.connectionsGroup.appendChild(path);
  }

  handleNodeMouseDown(e, node) {
    e.stopPropagation();
    if (this.panMode) return;

    this.selectNode(node);
    this.isDraggingNode = true;
    this.draggedNode = node;
    this.dragStartX = e.clientX;
    this.dragStartY = e.clientY;
    this.nodeStartX = node.x;
    this.nodeStartY = node.y;
  }

  handlePortMouseDown(e, node, portType) {
    e.stopPropagation();
    if (this.panMode) return;

    this.isConnecting = true;
    this.connectionStart = { node: node, port: portType };
  }

  handleMouseDown(e) {
    if (this.panMode || e.button === 1) {
      this.isPanning = true;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.canvas.style.cursor = 'grabbing';
    }
  }

  handleMouseMove(e) {
    if (this.isPanning) {
      const dx = e.clientX - this.panStartX;
      const dy = e.clientY - this.panStartY;
      this.panX += dx;
      this.panY += dy;
      this.panStartX = e.clientX;
      this.panStartY = e.clientY;
      this.updateTransform();
    } else if (this.isDraggingNode && this.draggedNode) {
      const dx = (e.clientX - this.dragStartX) / this.scale;
      const dy = (e.clientY - this.dragStartY) / this.scale;
      this.draggedNode.x = this.nodeStartX + dx;
      this.draggedNode.y = this.nodeStartY + dy;
      this.updateNode(this.draggedNode);
      this.updateConnections();
    }
  }

  handleMouseUp(e) {
    this.isPanning = false;
    this.isDraggingNode = false;
    this.draggedNode = null;
    this.canvas.style.cursor = this.panMode ? 'grab' : 'default';

    if (this.isConnecting) {
      // Check if released over a port
      const target = e.target;
      if (target.classList.contains('input-port') && this.connectionStart.port === 'output') {
        // Create connection
        const toNodeId = target.parentElement.id;
        const connection = new WorkflowConnection(
          `conn_${this.state.nextConnectionId++}`,
          this.connectionStart.node.id,
          0,
          toNodeId,
          0
        );
        this.state.addConnection(connection);
        this.renderConnection(connection);
      }
      this.isConnecting = false;
      this.connectionStart = null;
    }
  }

  handleWheel(e) {
    e.preventDefault();
    const delta = e.deltaY > 0 ? 0.9 : 1.1;
    const newScale = Math.max(0.1, Math.min(3, this.scale * delta));

    const rect = this.canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    this.panX = x - (x - this.panX) * (newScale / this.scale);
    this.panY = y - (y - this.panY) * (newScale / this.scale);
    this.scale = newScale;

    this.updateTransform();
  }

  updateTransform() {
    const transform = `translate(${this.panX}px, ${this.panY}px) scale(${this.scale})`;
    this.nodesGroup.style.transform = transform;
    this.connectionsGroup.style.transform = transform;
  }

  updateNode(node) {
    const g = document.getElementById(node.id);
    if (g) {
      g.setAttribute('transform', `translate(${node.x}, ${node.y})`);
    }
  }

  updateConnections() {
    this.state.connections.forEach(conn => {
      const path = document.getElementById(conn.id);
      if (path) {
        path.setAttribute('d', conn.getPath(this.state.nodes));
      }
    });
  }

  selectNode(node) {
    // Remove previous selection
    document.querySelectorAll('.workflow-node').forEach(n => {
      n.classList.remove('selected');
    });

    // Add selection
    const g = document.getElementById(node.id);
    if (g) {
      g.classList.add('selected');
      const rect = g.querySelector('rect');
      rect.setAttribute('stroke-width', 3);
    }

    this.state.selectedNode = node;
    this.showProperties(node);
  }

  showProperties(node) {
    const panel = document.getElementById('propertiesContent');
    panel.innerHTML = `
      <div class="property-group">
        <label>Node ID</label>
        <input type="text" value="${node.id}" readonly class="form-input">
      </div>
      <div class="property-group">
        <label>Type</label>
        <input type="text" value="${node.type}" readonly class="form-input">
      </div>
      ${this.getTypeSpecificProperties(node)}
    `;

    // Add event listeners for property changes
    panel.querySelectorAll('input, textarea, select').forEach(input => {
      input.addEventListener('change', (e) => {
        const key = e.target.dataset.key;
        if (key) {
          node.config[key] = e.target.value;
        }
      });
    });
  }

  getTypeSpecificProperties(node) {
    switch (node.type) {
      case 'tool':
        return `
          <div class="property-group">
            <label>Tool Name</label>
            <input type="text" data-key="toolName" value="${node.config.toolName || ''}" class="form-input" placeholder="e.g., fetch_url">
          </div>
          <div class="property-group">
            <label>Parameters (JSON)</label>
            <textarea data-key="parameters" class="form-textarea" rows="4">${JSON.stringify(node.config.parameters || {}, null, 2)}</textarea>
          </div>
        `;
      case 'prompt':
        return `
          <div class="property-group">
            <label>Template</label>
            <textarea data-key="template" class="form-textarea" rows="6">${node.config.template || ''}</textarea>
          </div>
        `;
      case 'resource':
        return `
          <div class="property-group">
            <label>URI</label>
            <input type="text" data-key="uri" value="${node.config.uri || ''}" class="form-input" placeholder="file:///path/to/resource">
          </div>
          <div class="property-group">
            <label>Type</label>
            <select data-key="type" class="form-input">
              <option value="file" ${node.config.type === 'file' ? 'selected' : ''}>File</option>
              <option value="url" ${node.config.type === 'url' ? 'selected' : ''}>URL</option>
              <option value="database" ${node.config.type === 'database' ? 'selected' : ''}>Database</option>
            </select>
          </div>
        `;
      case 'condition':
        return `
          <div class="property-group">
            <label>Expression</label>
            <input type="text" data-key="expression" value="${node.config.expression || ''}" class="form-input" placeholder="e.g., result.status === 'success'">
          </div>
        `;
      case 'sampling':
        return `
          <div class="property-group">
            <label>Strategy</label>
            <select data-key="strategy" class="form-input">
              <option value="temperature" ${node.config.strategy === 'temperature' ? 'selected' : ''}>Temperature</option>
              <option value="top_p" ${node.config.strategy === 'top_p' ? 'selected' : ''}>Top-P</option>
              <option value="top_k" ${node.config.strategy === 'top_k' ? 'selected' : ''}>Top-K</option>
            </select>
          </div>
          <div class="property-group">
            <label>Temperature</label>
            <input type="number" data-key="temperature" value="${node.config.temperature || 0.7}" class="form-input" step="0.1" min="0" max="2">
          </div>
          <div class="property-group">
            <label>Max Tokens</label>
            <input type="number" data-key="maxTokens" value="${node.config.maxTokens || 1000}" class="form-input">
          </div>
        `;
      default:
        return '';
    }
  }

  deleteNode(nodeId) {
    const g = document.getElementById(nodeId);
    if (g) {
      g.remove();
    }
    this.state.removeNode(nodeId);
    this.updateConnections();

    // Clear properties panel
    document.getElementById('propertiesContent').innerHTML = '<div class="empty-state"><p>Select a node to edit its properties</p></div>';
  }

  deleteSelected() {
    if (this.state.selectedNode) {
      this.deleteNode(this.state.selectedNode.id);
    }
  }

  zoomIn() {
    this.scale = Math.min(3, this.scale * 1.2);
    this.updateTransform();
  }

  zoomOut() {
    this.scale = Math.max(0.1, this.scale / 1.2);
    this.updateTransform();
  }

  zoomReset() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.updateTransform();
  }

  togglePanMode() {
    this.panMode = !this.panMode;
    this.canvas.style.cursor = this.panMode ? 'grab' : 'default';
    document.getElementById('btnPan').classList.toggle('active', this.panMode);
  }

  clear() {
    this.nodesGroup.innerHTML = '';
    this.connectionsGroup.innerHTML = '';
    this.state.clear();
    document.getElementById('propertiesContent').innerHTML = '<div class="empty-state"><p>Select a node to edit its properties</p></div>';
  }

  exportWorkflow() {
    return {
      name: document.getElementById('workflowName').textContent,
      version: '1.0',
      nodes: this.state.nodes.map(n => ({
        id: n.id,
        type: n.type,
        x: n.x,
        y: n.y,
        config: n.config
      })),
      connections: this.state.connections.map(c => ({
        id: c.id,
        from: c.fromNode,
        to: c.toNode
      }))
    };
  }

  loadWorkflow(workflow) {
    this.clear();

    // Load nodes
    workflow.nodes.forEach(nodeData => {
      const node = new WorkflowNode(nodeData.id, nodeData.type, nodeData.x, nodeData.y);
      node.config = nodeData.config;
      this.state.addNode(node);
      this.renderNode(node);
    });

    // Load connections
    workflow.connections.forEach(connData => {
      const connection = new WorkflowConnection(connData.id, connData.from, 0, connData.to, 0);
      this.state.addConnection(connection);
      this.renderConnection(connection);
    });

    // Update IDs
    const maxNodeId = Math.max(0, ...this.state.nodes.map(n => parseInt(n.id.split('_')[1])));
    const maxConnId = Math.max(0, ...this.state.connections.map(c => parseInt(c.id.split('_')[1])));
    this.state.nextNodeId = maxNodeId + 1;
    this.state.nextConnectionId = maxConnId + 1;
  }

  highlightNode(nodeId, status) {
    const g = document.getElementById(nodeId);
    if (g) {
      const rect = g.querySelector('rect');
      const colors = {
        running: '#f59e0b',
        completed: '#22c55e',
        failed: '#ef4444'
      };
      rect.setAttribute('stroke', colors[status] || '#6366f1');
      rect.setAttribute('stroke-width', 3);
    }
  }

  clearHighlights() {
    this.state.nodes.forEach(node => {
      const g = document.getElementById(node.id);
      if (g) {
        const rect = g.querySelector('rect');
        rect.setAttribute('stroke', node.getColor());
        rect.setAttribute('stroke-width', 2);
      }
    });
  }
}
