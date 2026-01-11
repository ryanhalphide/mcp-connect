/**
 * Touch Gesture Handler - Swipe gestures for mobile workflow management
 */

export class SwipeGestureHandler {
  constructor(element, options = {}) {
    this.element = element;
    this.options = {
      threshold: 50, // Minimum distance for swipe
      restraint: 100, // Maximum perpendicular distance
      allowedTime: 500, // Maximum time for swipe
      ...options
    };

    this.startX = 0;
    this.startY = 0;
    this.startTime = 0;
    this.distX = 0;
    this.distY = 0;
    this.elapsedTime = 0;

    this.init();
  }

  init() {
    this.element.addEventListener('touchstart', (e) => this.handleTouchStart(e), { passive: true });
    this.element.addEventListener('touchmove', (e) => this.handleTouchMove(e), { passive: true });
    this.element.addEventListener('touchend', (e) => this.handleTouchEnd(e), { passive: true });
  }

  handleTouchStart(e) {
    const touch = e.changedTouches[0];
    this.startX = touch.pageX;
    this.startY = touch.pageY;
    this.startTime = new Date().getTime();
    this.element.style.transition = 'none';
  }

  handleTouchMove(e) {
    const touch = e.changedTouches[0];
    this.distX = touch.pageX - this.startX;
    this.distY = touch.pageY - this.startY;

    // Show visual feedback during swipe
    if (Math.abs(this.distX) > 10 && Math.abs(this.distX) > Math.abs(this.distY)) {
      this.element.style.transform = `translateX(${this.distX}px)`;
      this.element.style.opacity = 1 - Math.abs(this.distX) / 200;
    }
  }

  handleTouchEnd(e) {
    this.elapsedTime = new Date().getTime() - this.startTime;

    // Reset styles
    this.element.style.transition = 'transform 0.3s ease, opacity 0.3s ease';
    this.element.style.transform = 'translateX(0)';
    this.element.style.opacity = '1';

    // Check if swipe is valid
    if (this.elapsedTime <= this.options.allowedTime) {
      // Horizontal swipe
      if (Math.abs(this.distX) >= this.options.threshold && Math.abs(this.distY) <= this.options.restraint) {
        if (this.distX < 0) {
          this.onSwipeLeft();
        } else {
          this.onSwipeRight();
        }
      }
      // Vertical swipe
      else if (Math.abs(this.distY) >= this.options.threshold && Math.abs(this.distX) <= this.options.restraint) {
        if (this.distY < 0) {
          this.onSwipeUp();
        } else {
          this.onSwipeDown();
        }
      }
    }
  }

  onSwipeLeft() {
    // Override in implementation
    console.log('Swipe left detected');
  }

  onSwipeRight() {
    // Override in implementation
    console.log('Swipe right detected');
  }

  onSwipeUp() {
    // Override in implementation
    console.log('Swipe up detected');
  }

  onSwipeDown() {
    // Override in implementation
    console.log('Swipe down detected');
  }
}

/**
 * Workflow Card Swipe Handler
 * Extends SwipeGestureHandler for workflow cards
 */
export class WorkflowCardSwipeHandler extends SwipeGestureHandler {
  constructor(element, workflow, callbacks = {}) {
    super(element);
    this.workflow = workflow;
    this.callbacks = callbacks;
  }

  onSwipeLeft() {
    // Show delete/archive actions
    if (this.callbacks.onDelete || this.callbacks.onArchive) {
      this.showLeftActions();
    }
  }

  onSwipeRight() {
    // Show execute/favorite actions
    if (this.callbacks.onExecute || this.callbacks.onFavorite) {
      this.showRightActions();
    }
  }

  showLeftActions() {
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'swipe-actions swipe-actions-left';

    if (this.callbacks.onArchive) {
      const archiveBtn = document.createElement('button');
      archiveBtn.className = 'swipe-action-btn archive';
      archiveBtn.innerHTML = '📦 Archive';
      archiveBtn.onclick = () => this.callbacks.onArchive(this.workflow);
      actionsContainer.appendChild(archiveBtn);
    }

    if (this.callbacks.onDelete) {
      const deleteBtn = document.createElement('button');
      deleteBtn.className = 'swipe-action-btn delete';
      deleteBtn.innerHTML = '🗑️ Delete';
      deleteBtn.onclick = () => this.callbacks.onDelete(this.workflow);
      actionsContainer.appendChild(deleteBtn);
    }

    this.element.parentElement.appendChild(actionsContainer);
    setTimeout(() => actionsContainer.remove(), 3000);
  }

  showRightActions() {
    const actionsContainer = document.createElement('div');
    actionsContainer.className = 'swipe-actions swipe-actions-right';

    if (this.callbacks.onExecute) {
      const executeBtn = document.createElement('button');
      executeBtn.className = 'swipe-action-btn execute';
      executeBtn.innerHTML = '▶️ Execute';
      executeBtn.onclick = () => this.callbacks.onExecute(this.workflow);
      actionsContainer.appendChild(executeBtn);
    }

    if (this.callbacks.onFavorite) {
      const favoriteBtn = document.createElement('button');
      favoriteBtn.className = 'swipe-action-btn favorite';
      favoriteBtn.innerHTML = '⭐ Favorite';
      favoriteBtn.onclick = () => this.callbacks.onFavorite(this.workflow);
      actionsContainer.appendChild(favoriteBtn);
    }

    this.element.parentElement.appendChild(actionsContainer);
    setTimeout(() => actionsContainer.remove(), 3000);
  }
}

/**
 * Initialize swipe gestures for all workflow cards
 */
export function initializeWorkflowSwipes(callbacks = {}) {
  const workflowCards = document.querySelectorAll('.workflow-card');

  workflowCards.forEach(card => {
    const workflowId = card.dataset.workflowId;
    const workflow = { id: workflowId, name: card.dataset.workflowName };

    new WorkflowCardSwipeHandler(card, workflow, callbacks);
  });
}
