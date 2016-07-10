import Rx from 'rx';

import { isPlainObject } from '../utils';
import {
  throwShapeError,
  throwChildrenError,
  throwFinalizedError
} from '../errors';

export const createTreeSetNextState = (childrenObservable) => {
  const newStateSubject = new Rx.Subject();
  newStateSubject
    .withLatestFrom(childrenObservable)
    .subscribe(([newState, children]) => {
      const keys = Object.keys(children);
      const newKeys = Object.keys(newState);

      if (newKeys.length !== keys.length) {
        throwShapeError();
      }

      keys.forEach(key => {
        if (key in newState) {
          children[key].getValue().setNextState(newState[key]);
        } else {
          throwShapeError();
        }
      });
    });

  return (newState) => {
    newStateSubject.onNext(newState);
  };
};

export const createTreeObservable = (childrenObservable) => {
  return childrenObservable
    .flatMapLatest(children => {
      const keys = Object.keys(children);
      return Rx.Observable.combineLatest(
        ...keys.map(key => {
          return children[key]
        })
        ,(...latestNodes) => {
          return latestNodes.reduce((acc, val, i) => {
            if (!val.provisional) {
              acc[keys[i]] = val;
            }
            return acc;
          }, {});
        });
    })
    .flatMapLatest(nodes => {
      const keys = Object.keys(nodes);
      return Rx.Observable
        .combineLatest(
          ...keys
            .map(key => nodes[key].combinedObservable),
          (...latestValues) => {
            return latestValues.reduce((acc, val, i) => {
              acc[keys[i]] = val;
              return acc;
            }, {});
          });
    });
};

export const createChildrenObservable = ({
  addChildrenSubject,
  getChildrenSubject,
  pauser,
  hookMap,
  createNode
}) => {
  return addChildrenSubject
    .withLatestFrom(getChildrenSubject, (child, acc) => {
      const { key, value, provisional } = child;
      const oldNode = acc[key] && acc[key].getValue();
      if(!oldNode || oldNode.provisional) {
        const newNode = createTree({
          initialState: value,
          pauser,
          hookMap,
          createNode,
          provisional,
          provisionalNode: oldNode
        });
        return Object.assign({}, acc, {
          [key]: newNode.nodeSubject
        });
      } else if (!oldNode.provisional) {
        throwFinalizedError(key);
      } else {
        return acc;
      }
    })
    .shareReplay(1);
}

export const updateAddChildrenSubject = (initialState, addChildrenSubject, pauser) => {
  const keys = Object.keys(initialState);
  pauser.onNext(false);
  keys.forEach((key) => {
    addChildrenSubject.onNext(
      { key, value: initialState[key], provisional: false }
    );
  });
  pauser.onNext(true);
};

export const createFinalTreeFromProvisionalNode = ({
  initialState,
  createNode,
  provisionalNode
}) => {
  const {
    addChildrenSubject,
    pauser
  } = provisionalNode;
  updateAddChildrenSubject(initialState, addChildrenSubject, pauser);
  return createNode({
    provisional: false,
    provisionalNode
  });
}

const createInitialTree = ({
  initialState,
  pauser,
  hookMap,
  createNode,
  provisional,
  provisionalNode
}) => {
  if (!pauser) {
    pauser = new Rx.BehaviorSubject(true);
  }
  if (!hookMap) {
    hookMap = new WeakMap();
  }
  const addChildrenSubject = new Rx.Subject();
  const getChildrenSubject = new Rx.BehaviorSubject({});
  const childrenObservable = createChildrenObservable({
    addChildrenSubject,
    getChildrenSubject,
    pauser,
    hookMap,
    createNode
  });

  const valueSubject = new Rx.ReplaySubject(1);

  childrenObservable.subscribe(getChildrenSubject)
  childrenObservable.subscribeOnError(err => { throw err });

  if (!provisional) {
    updateAddChildrenSubject(initialState, addChildrenSubject, pauser);
  }

  const valueObservable = createTreeObservable(childrenObservable)
    .pausable(pauser);
  const setNextState = createTreeSetNextState(childrenObservable, pauser);

  valueObservable.subscribe(valueSubject);

  const node = createNode({
    addChildrenSubject,
    getChildrenSubject,
    pauser,
    observable: valueSubject.asObservable(),
    hookMap,
    setNextState,
    provisional,
    provisionalNode
  });

  return node;
};

export const createLeaf = ({
  initialState,
  pauser,
  createNode,
  hookMap,
  provisionalNode
}) => {
  if (
    provisionalNode &&
    Object.keys(provisionalNode.getChildrenSubject.getValue()).length
  ) {
    throw new Error('Tried to create leaf node when provisional has children');
  }
  if (!pauser) {
    pauser = new Rx.BehaviorSubject(true);
  }
  if (!hookMap) {
    hookMap = new WeakMap();
  }
  const subject = new Rx.BehaviorSubject(initialState);
  const observable = subject
    .distinctUntilChanged();
  const setNextState = (newState) => {
    subject.onNext(newState);
  }

  return createNode({
    observable,
    hookMap,
    pauser,
    setNextState,
    provisional: false,
    provisionalNode
  });
};

export const createTree = ({
  initialState,
  pauser,
  hookMap,
  createNode,
  provisional,
  provisionalNode
}) => {
  if (typeof initialState === 'undefined') {
    return createInitialTree({
      initialState: null,
      pauser,
      hookMap,
      createNode,
      provisional: true
    });
  } else if (!provisional) {
    if (!isPlainObject(initialState)) {
      return createLeaf({
        initialState,
        pauser,
        createNode,
        hookMap,
        provisionalNode
      });
    }
    else if (provisionalNode) {
      return createFinalTreeFromProvisionalNode({
        initialState,
        createNode,
        provisionalNode
      });
    }
  }

  return createInitialTree({
    initialState,
    pauser,
    hookMap,
    createNode,
    provisional,
    provisionalNode
  });
};

export default createTree;
