import state from './state';
import { filterTodos } from '../actions';
import { filters } from '../constants';

const createFilteredTodos = filter => todo => {
  switch(filter) {
    case filters.SHOW_ACTIVE:
      return !todo.completed;
    case filters.SHOW_COMPLETED:
      return todo.completed;
    default:
      return true;
  }
};

const displayState = state('display')
  .setInitialState({
    filteredTodos: null,
    filter: filters.SHOW_ALL,
    counts: {
      completed: null,
      active: null,
      allCompleted: null,
      total: null
    }
  });

displayState('filter')
  .reduce(filterTodos, (state, filter) => filter);

displayState('filteredTodos')
  .reduce(
    [
      state('todos').asObservable(),
      displayState('filter').asObservable()
    ],
    (filtered, [todos, filter]) => (
      todos.filter(createFilteredTodos(filter))
    )
  );

displayState('counts')
  .reduce(state('todos').asObservable(), (counts, todos) => {
    const completedCount = todos.reduce((count, todo) => (
      todo.completed ? count + 1 : count
    ), 0);
    return {
      completed: completedCount,
      active: todos.length - completedCount,
      allCompleted: completedCount === todos.length,
      total: todos.length
    };
  });
