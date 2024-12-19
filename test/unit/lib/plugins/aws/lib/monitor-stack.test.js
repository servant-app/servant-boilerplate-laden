'use strict';

const chai = require('chai');
const sinon = require('sinon');
const Serverless = require('../../../../../../lib/serverless');
const AwsProvider = require('../../../../../../lib/plugins/aws/provider');
const CLI = require('../../../../../../lib/classes/cli');
const monitorStack = require('../../../../../../lib/plugins/aws/lib/monitor-stack');

chai.use(require('chai-as-promised'));

const { expect } = chai;

describe('monitorStack', () => {
  const serverless = new Serverless({ commands: [], options: {} });
  const awsPlugin = {};

  beforeEach(() => {
    const options = {
      stage: 'dev',
      region: 'us-east-1',
    };
    awsPlugin.serverless = serverless;
    awsPlugin.provider = new AwsProvider(serverless, options);
    awsPlugin.serverless.cli = new CLI(serverless);
    awsPlugin.options = options;

    Object.assign(awsPlugin, monitorStack);
  });

  describe('#monitorStack()', () => {
    it('should skip monitoring if the stack was already created', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');

      return awsPlugin.monitorStack('update', 'alreadyCreated', { frequency: 10 }).then(() => {
        expect(describeStackEventsStub.callCount).to.be.equal(0);
        awsPlugin.provider.request.restore();
      });
    });

    it('should keep monitoring until CREATE_COMPLETE stack status', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      };
      const updateFinishedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(updateFinishedEvent);

      return awsPlugin.monitorStack('create', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(2);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('CREATE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should keep monitoring until UPDATE_COMPLETE stack status', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      };
      const updateFinishedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(updateFinishedEvent);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(2);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('UPDATE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should keep monitoring until DELETE_COMPLETE stack status', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const updateFinishedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(updateFinishedEvent);

      return awsPlugin.monitorStack('delete', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(2);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('DELETE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should not stop monitoring on CREATE_COMPLETE nested stack status', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      };
      const nestedStackEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4z',
            StackName: 'new-service-dev',
            LogicalResourceId: 'nested-stack-name',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };
      const updateFinishedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(nestedStackEvent);
      describeStackEventsStub.onCall(2).resolves(updateFinishedEvent);

      return awsPlugin.monitorStack('create', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(3);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('CREATE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should not stop monitoring on UPDATE_COMPLETE nested stack status', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      };
      const nestedStackEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4z',
            StackName: 'new-service-dev',
            LogicalResourceId: 'nested-stack-name',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_COMPLETE',
          },
        ],
      };
      const updateFinishedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(nestedStackEvent);
      describeStackEventsStub.onCall(2).resolves(updateFinishedEvent);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(3);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('UPDATE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should not stop monitoring on DELETE_COMPLETE nested stack status', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const nestedStackEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4z',
            StackName: 'new-service-dev',
            LogicalResourceId: 'nested-stack-name',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_COMPLETE',
          },
        ],
      };
      const updateFinishedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(nestedStackEvent);
      describeStackEventsStub.onCall(2).resolves(updateFinishedEvent);

      return awsPlugin.monitorStack('delete', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(3);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('DELETE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should keep monitoring until DELETE_COMPLETE or stack not found catch', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const stackNotFoundError = {
        message: 'Stack new-service-dev does not exist',
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).rejects(stackNotFoundError);

      return awsPlugin.monitorStack('delete', cfDataMock, { frequency: 10 }).then((stackStatus) => {
        expect(describeStackEventsStub.callCount).to.be.equal(2);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        expect(stackStatus).to.be.equal('DELETE_COMPLETE');
        awsPlugin.provider.request.restore();
      });
    });

    it('should output all stack events information with the --verbose option', () => {
      awsPlugin.options.verbose = true;
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      };
      const updateFailedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaS3',
            ResourceType: 'AWS::S3::Bucket',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'Bucket already exists',
          },
        ],
      };
      const updateRollbackEvent = {
        StackEvents: [
          {
            EventId: '1i2j3k4l',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
          },
        ],
      };
      const updateRollbackComplete = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'ROLLBACK_COMPLETE',
          },
        ],
      };
      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(updateFailedEvent);
      describeStackEventsStub.onCall(2).resolves(updateRollbackEvent);
      describeStackEventsStub.onCall(3).resolves(updateRollbackComplete);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).catch((e) => {
        let errorMessage = 'An error occurred: ';
        errorMessage += 'mochaS3 - Bucket already exists.';
        if (e.name !== 'ServerlessError') throw e;
        expect(e.name).to.be.equal('ServerlessError');
        expect(e.message).to.be.equal(errorMessage);
        expect(describeStackEventsStub.callCount).to.be.equal(4);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });

    it('should keep monitoring when 1st ResourceType is not "AWS::CloudFormation::Stack"', async () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const firstNoStackResourceTypeEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'somebucket',
            ResourceType: 'AWS::S3::Bucket',
            Timestamp: new Date(),
          },
        ],
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      };
      const updateComplete = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_COMPLETE',
          },
        ],
      };
      describeStackEventsStub.onCall(0).resolves(firstNoStackResourceTypeEvent);
      describeStackEventsStub.onCall(1).resolves(updateStartEvent);
      describeStackEventsStub.onCall(2).resolves(updateComplete);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).then(() => {
        expect(describeStackEventsStub.callCount).to.be.equal(3);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });

    it('should catch describeStackEvents error if stack was not in deleting state', () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const failedDescribeStackEvents = {
        message: 'Something went wrong.',
      };

      describeStackEventsStub.onCall(0).rejects(failedDescribeStackEvents);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).catch((e) => {
        expect(e.message).to.be.equal('Something went wrong.');
        expect(describeStackEventsStub.callCount).to.be.equal(1);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });

    it('should throw an error and exit immediately if stack status is *_FAILED', () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            LogicalResourceId: 'mocha',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      };
      const updateFailedEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            LogicalResourceId: 'mochaS3',
            ResourceType: 'S3::Bucket',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'Bucket already exists',
          },
        ],
      };
      const updateRollbackEvent = {
        StackEvents: [
          {
            EventId: '1i2j3k4l',
            LogicalResourceId: 'mocha',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
          },
        ],
      };
      const updateRollbackFailedEvent = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            LogicalResourceId: 'mocha',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_ROLLBACK_FAILED',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(updateFailedEvent);
      describeStackEventsStub.onCall(2).resolves(updateRollbackEvent);
      describeStackEventsStub.onCall(3).resolves(updateRollbackFailedEvent);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).catch((e) => {
        let errorMessage = 'An error occurred: ';
        errorMessage += 'mochaS3 - Bucket already exists.';
        expect(e.name).to.be.equal('ServerlessError');
        expect(e.message).to.be.equal(errorMessage);
        // callCount is 2 because Serverless will immediately exits and shows the error
        expect(describeStackEventsStub.callCount).to.be.equal(2);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });

    it('should throw an error and exit immediately if stack status is DELETE_FAILED', () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const deleteStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const deleteItemEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaLambda',
            ResourceType: 'AWS::Lambda::Function',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const deleteItemFailedEvent = {
        StackEvents: [
          {
            EventId: '1i2j3k4l',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaLambda',
            ResourceType: 'AWS::Lambda::Function',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_FAILED',
            ResourceStatusReason: 'You are not authorized to perform this operation',
          },
        ],
      };
      const deleteFailedEvent = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_FAILED',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(deleteStartEvent);
      describeStackEventsStub.onCall(1).resolves(deleteItemEvent);
      describeStackEventsStub.onCall(2).resolves(deleteItemFailedEvent);
      describeStackEventsStub.onCall(3).resolves(deleteFailedEvent);

      return awsPlugin.monitorStack('delete', cfDataMock, { frequency: 10 }).catch((e) => {
        let errorMessage = 'An error occurred: ';
        errorMessage += 'mochaLambda - You are not authorized to perform this operation.';
        expect(e.name).to.be.equal('ServerlessError');
        expect(e.message).to.be.equal(errorMessage);
        // callCount is 2 because Serverless will immediately exits and shows the error
        expect(describeStackEventsStub.callCount).to.be.equal(3);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });

    it('should exit if stack status is UPDATE_FAILED when using --verbose', () => {
      awsPlugin.options.verbose = true;
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const deleteStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const deleteItemEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaLambda',
            ResourceType: 'AWS::Lambda::Function',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
        ],
      };
      const updateItemFailedEvent = {
        StackEvents: [
          {
            EventId: '1i2j3k4l',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaLambda',
            ResourceType: 'AWS::Lambda::Function',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_FAILED',
            ResourceStatusReason: 'You are not authorized to perform this operation',
          },
        ],
      };
      const updateFailedEvent = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_FAILED',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(deleteStartEvent);
      describeStackEventsStub.onCall(1).resolves(deleteItemEvent);
      describeStackEventsStub.onCall(2).resolves(updateItemFailedEvent);
      describeStackEventsStub.onCall(3).resolves(updateFailedEvent);

      return awsPlugin.monitorStack('delete', cfDataMock, { frequency: 10 }).catch((e) => {
        let errorMessage = 'An error occurred: ';
        errorMessage += 'mochaLambda - You are not authorized to perform this operation.';
        expect(e.name).to.be.equal('ServerlessError');
        expect(e.message).to.be.equal(errorMessage);

        expect(describeStackEventsStub.callCount).to.be.equal(4);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });
    it('should exit if stack status is CREATE_FAILED when using --verbose', () => {
      awsPlugin.options.verbose = true;
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const deleteStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      };
      const deleteItemEvent = {
        StackEvents: [
          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaLambda',
            ResourceType: 'AWS::Lambda::Function',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      };
      const updateItemFailedEvent = {
        StackEvents: [
          {
            EventId: '1i2j3k4l',
            StackName: 'new-service-dev',
            LogicalResourceId: 'mochaLambda',
            ResourceType: 'AWS::Lambda::Function',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'You are not authorized to perform this operation',
          },
        ],
      };
      const updateFailedEvent = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_FAILED',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(deleteStartEvent);
      describeStackEventsStub.onCall(1).resolves(deleteItemEvent);
      describeStackEventsStub.onCall(2).resolves(updateItemFailedEvent);
      describeStackEventsStub.onCall(3).resolves(updateFailedEvent);

      return awsPlugin.monitorStack('create', cfDataMock, { frequency: 10 }).catch((e) => {
        let errorMessage = 'An error occurred: ';
        errorMessage += 'mochaLambda - You are not authorized to perform this operation.';
        expect(e.name).to.be.equal('ServerlessError');
        expect(e.message).to.be.equal(errorMessage);

        expect(describeStackEventsStub.callCount).to.be.equal(4);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });

    it(
      'should throw an error if stack status is DELETE_FAILED and should output all ' +
        'stack events information with the --verbose option',
      () => {
        awsPlugin.options.verbose = true;
        const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
        const cfDataMock = {
          StackId: 'new-service-dev',
        };
        const deleteStartEvent = {
          StackEvents: [
            {
              EventId: '1a2b3c4d',
              StackName: 'new-service-dev',
              LogicalResourceId: 'new-service-dev',
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_IN_PROGRESS',
            },
          ],
        };
        const deleteItemEvent = {
          StackEvents: [
            {
              EventId: '1e2f3g4h',
              StackName: 'new-service-dev',
              LogicalResourceId: 'mochaLambda',
              ResourceType: 'AWS::Lambda::Function',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_IN_PROGRESS',
            },
          ],
        };
        const deleteItemFailedEvent = {
          StackEvents: [
            {
              EventId: '1i2j3k4l',
              StackName: 'new-service-dev',
              LogicalResourceId: 'mochaLambda',
              ResourceType: 'AWS::Lambda::Function',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_FAILED',
              ResourceStatusReason: 'You are not authorized to perform this operation',
            },
          ],
        };
        const deleteFailedEvent = {
          StackEvents: [
            {
              EventId: '1m2n3o4p',
              StackName: 'new-service-dev',
              LogicalResourceId: 'new-service-dev',
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_FAILED',
            },
          ],
        };

        describeStackEventsStub.onCall(0).resolves(deleteStartEvent);
        describeStackEventsStub.onCall(1).resolves(deleteItemEvent);
        describeStackEventsStub.onCall(2).resolves(deleteItemFailedEvent);
        describeStackEventsStub.onCall(3).resolves(deleteFailedEvent);

        return awsPlugin.monitorStack('delete', cfDataMock, { frequency: 10 }).catch((e) => {
          let errorMessage = 'An error occurred: ';
          errorMessage += 'mochaLambda - You are not authorized to perform this operation.';
          expect(e.name).to.be.equal('ServerlessError');
          expect(e.message).to.be.equal(errorMessage);
          // callCount is 2 because Serverless will immediately exits and shows the error
          expect(describeStackEventsStub.callCount).to.be.equal(4);
          expect(
            describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
              StackName: cfDataMock.StackId,
            })
          ).to.be.equal(true);
          awsPlugin.provider.request.restore();
        });
      }
    );

    it(
      'should throw an error if stack status is DELETE_COMPLETE and should output all ' +
        'stack events information with the --verbose option',
      async () => {
        awsPlugin.options.verbose = true;
        const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
        const cfDataMock = {
          StackId: 'new-service-dev',
        };
        const createStartEvent = {
          StackEvents: [
            {
              EventId: '1a2b3c4d',
              StackName: 'new-service-dev',
              LogicalResourceId: 'new-service-dev',
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: 'CREATE_IN_PROGRESS',
            },
          ],
        };
        const createItemFailedEvent = {
          StackEvents: [
            {
              EventId: '1m2n3o4p',
              StackName: 'new-service-dev',
              LogicalResourceId: 'new-service-dev',
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_COMPLETE',
            },
            {
              EventId: '1i2j3k4l',
              StackName: 'new-service-dev',
              LogicalResourceId: 'myBucket',
              ResourceType: 'AWS::S3::Bucket',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_IN_PROGRESS',
            },
            {
              EventId: '1a2b3c4e',
              StackName: 'new-service-dev',
              LogicalResourceId: 'new-service-dev',
              ResourceType: 'AWS::CloudFormation::Stack',
              Timestamp: new Date(),
              ResourceStatus: 'DELETE_IN_PROGRESS',
            },

            {
              EventId: '1e2f3g4h',
              StackName: 'new-service-dev',
              LogicalResourceId: 'myBucket',
              ResourceType: 'AWS::S3::Bucket',
              Timestamp: new Date(),
              ResourceStatus: 'CREATE_FAILED',
              ResourceStatusReason: 'Invalid Property for X',
            },
          ],
        };

        describeStackEventsStub.onCall(0).resolves(createStartEvent);
        describeStackEventsStub.onCall(1).resolves(createItemFailedEvent);

        await expect(
          awsPlugin.monitorStack('create', cfDataMock, { frequency: 10 })
        ).to.eventually.be.rejectedWith('myBucket - Invalid Property for X.');
        awsPlugin.provider.request.restore();
      }
    );

    it('should resolve properly first stack event (when CREATE fails and is followed with DELETE)', async () => {
      awsPlugin.options.verbose = true;
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const createStartEvent = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_COMPLETE',
          },
          {
            EventId: '1i2j3k4l',
            StackName: 'new-service-dev',
            LogicalResourceId: 'myBucket',
            ResourceType: 'AWS::S3::Bucket',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },
          {
            EventId: '1a2b3c4e',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'DELETE_IN_PROGRESS',
          },

          {
            EventId: '1e2f3g4h',
            StackName: 'new-service-dev',
            LogicalResourceId: 'myBucket',
            ResourceType: 'AWS::S3::Bucket',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_FAILED',
            ResourceStatusReason: 'Invalid Property for X',
          },
          {
            EventId: '1a2b3c4d',
            StackName: 'new-service-dev',
            LogicalResourceId: 'new-service-dev',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'CREATE_IN_PROGRESS',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(createStartEvent);

      await expect(
        awsPlugin.monitorStack('create', cfDataMock, { frequency: 10 })
      ).to.eventually.be.rejectedWith('myBucket - Invalid Property for X.');
      awsPlugin.provider.request.restore();
    });

    it('should record an error and fail if status is UPDATE_ROLLBACK_IN_PROGRESS', () => {
      const describeStackEventsStub = sinon.stub(awsPlugin.provider, 'request');
      const cfDataMock = {
        StackId: 'new-service-dev',
      };
      const updateStartEvent = {
        StackEvents: [
          {
            EventId: '1a2b3c4d',
            LogicalResourceId: 'mocha',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_IN_PROGRESS',
          },
        ],
      };
      const updateRollbackEvent = {
        StackEvents: [
          {
            EventId: '1i2j3k4l',
            LogicalResourceId: 'mocha',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_ROLLBACK_IN_PROGRESS',
          },
        ],
      };
      const updateRollbackCompleteEvent = {
        StackEvents: [
          {
            EventId: '1m2n3o4p',
            LogicalResourceId: 'mocha',
            ResourceType: 'AWS::CloudFormation::Stack',
            Timestamp: new Date(),
            ResourceStatus: 'UPDATE_ROLLBACK_COMPLETE',
          },
        ],
      };

      describeStackEventsStub.onCall(0).resolves(updateStartEvent);
      describeStackEventsStub.onCall(1).resolves(updateRollbackEvent);
      describeStackEventsStub.onCall(2).resolves(updateRollbackCompleteEvent);

      return awsPlugin.monitorStack('update', cfDataMock, { frequency: 10 }).catch((e) => {
        let errorMessage = 'An error occurred: ';
        errorMessage += 'mocha - UPDATE_ROLLBACK_IN_PROGRESS.';
        expect(e.name).to.be.equal('ServerlessError');
        expect(e.message).to.be.equal(errorMessage);
        // callCount is 2 because Serverless will immediately exits and shows the error
        expect(describeStackEventsStub.callCount).to.be.equal(2);
        expect(
          describeStackEventsStub.calledWithExactly('CloudFormation', 'describeStackEvents', {
            StackName: cfDataMock.StackId,
          })
        ).to.be.equal(true);
        awsPlugin.provider.request.restore();
      });
    });
  });
});
