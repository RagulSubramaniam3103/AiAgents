import { TestBed } from '@angular/core/testing';

import { Agentconnection } from './agentconnection';

describe('Agentconnection', () => {
  let service: Agentconnection;

  beforeEach(() => {
    TestBed.configureTestingModule({});
    service = TestBed.inject(Agentconnection);
  });

  it('should be created', () => {
    expect(service).toBeTruthy();
  });
});
