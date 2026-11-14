// Pointer/touch input. Browser-only; translates DOM events into state.js calls.
(function (root) {
  const CellState = root.Garden.grid.CellState;

  function cellFromElement(el) {
    const cellEl = el && el.closest ? el.closest('.cell') : null;
    if (!cellEl) return null;
    return { row: parseInt(cellEl.dataset.row, 10), col: parseInt(cellEl.dataset.col, 10) };
  }

  function attach(dom, game, handlers) {
    let patternsEnabled = true;
    let drag = null; // { pointerId, startRow, startCol, mode, moved, visited }

    function applyDragAction(row, col) {
      if (drag.mode === 'mark') game.markCellX(row, col);
      else if (drag.mode === 'clear') game.clearCellX(row, col);
    }

    dom.board.addEventListener('pointerdown', function (event) {
      const hit = cellFromElement(event.target);
      if (!hit) return;

      const cell = game.getSnapshot().grid.cells[hit.row][hit.col];
      let mode = null;
      if (!cell.locked) {
        if (cell.state === CellState.EMPTY) mode = 'mark';
        else if (cell.state === CellState.X) mode = 'clear';
      }

      drag = { pointerId: event.pointerId, startRow: hit.row, startCol: hit.col, mode, moved: false, visited: new Set() };
      dom.board.setPointerCapture(event.pointerId);
      event.preventDefault();
    });

    dom.board.addEventListener('pointermove', function (event) {
      if (!drag || event.pointerId !== drag.pointerId) return;

      const hit = cellFromElement(document.elementFromPoint(event.clientX, event.clientY));
      if (!hit) return;

      if (!drag.moved && (hit.row !== drag.startRow || hit.col !== drag.startCol)) {
        drag.moved = true;
        if (drag.mode) {
          drag.visited.add(drag.startRow + ',' + drag.startCol);
          applyDragAction(drag.startRow, drag.startCol);
        }
      }

      if (!drag.moved || !drag.mode) return;

      const key = hit.row + ',' + hit.col;
      if (drag.visited.has(key)) return;
      drag.visited.add(key);
      applyDragAction(hit.row, hit.col);
    });

    function endDrag(event) {
      if (!drag || event.pointerId !== drag.pointerId) return;
      if (!drag.moved) game.tapCell(drag.startRow, drag.startCol);
      if (dom.board.hasPointerCapture(event.pointerId)) dom.board.releasePointerCapture(event.pointerId);
      drag = null;
    }

    dom.board.addEventListener('pointerup', endDrag);
    dom.board.addEventListener('pointercancel', endDrag);

    dom.nextLevelButton.addEventListener('click', function () {
      game.nextLevel();
    });

    dom.retryButton.addEventListener('click', function () {
      game.retryLevel();
    });

    dom.patternsToggle.addEventListener('click', function () {
      patternsEnabled = !patternsEnabled;
      handlers.onTogglePatterns(patternsEnabled);
    });

    return {
      setPatternsEnabled: function (enabled) {
        patternsEnabled = enabled;
      },
    };
  }

  root.Garden = root.Garden || {};
  root.Garden.input = { attach };
})(typeof window !== 'undefined' ? window : globalThis);
