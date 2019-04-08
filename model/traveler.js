/*jslint es5: true*/

var mongoose = require('mongoose');
var appConfig = require('../config/config').app;
var Schema = mongoose.Schema;
var ObjectId = Schema.Types.ObjectId;

var share = require('./share.js');
var DataError = require('../lib/error').DataError;

require('./binder');
var Binder = mongoose.model('Binder');

/**
 * A form can become active, inactive, and reactive. The form's activated date
 *   and the form's updated data can tell if the form has been updated since
 *   it is used by the traveler.
 * activatedOn: the dates when this form starts to be active
 * alias : a name for convenience to distinguish forms.
 * mapping : user-key -> name
 * labels: name -> label
 * inputs : list of input names in the form
 * mapping and inputs are decided by the form snapshot when a traveler is created from it.
 * they are within form because they will be never changed like the html once created.
 */

var form = new Schema({
  html: String,
  mapping: Schema.Types.Mixed,
  labels: Schema.Types.Mixed,
  // list of input names in the current active form
  // do not need this because of labels
  // inputs: [String],
  activatedOn: [Date],
  reference: ObjectId,
  alias: String,
});

var user = new Schema({
  _id: String,
  username: String,
});

/**
 * status := 0 // new
 *         | 1 // active
 *         | 1.5 // complete request
 *         | 2 // completed
 *         | 3 // frozen
 */

const statusMap = {
  '0': 'initialized',
  '1': 'active',
  '1.5': 'submitted for completion',
  '2': 'completed',
  '3': 'frozen',
  '4': 'archived',
};

var stateTransition = [
  {
    from: 0,
    to: [1, 4],
  },
  {
    from: 1,
    to: [1.5, 3, 4],
  },
  {
    from: 1.5,
    to: [1, 2],
  },
  {
    from: 2,
    to: [4],
  },
  {
    from: 3,
    to: [1],
  },
];

/**
 * publicAccess := 0 // for read or
 *               | 1 // for write or
 *               | -1 // no access
 */

var traveler = new Schema({
  title: String,
  description: String,
  devices: [String],
  locations: [String],
  manPower: [user],
  status: {
    type: Number,
    default: 0,
  },
  createdBy: String,
  createdOn: Date,
  clonedBy: String,
  clonedFrom: ObjectId,
  updatedBy: String,
  updatedOn: Date,
  archivedOn: Date,
  owner: String,
  tags: [String],
  transferredOn: Date,
  deadline: Date,
  publicAccess: {
    type: Number,
    default: appConfig.default_traveler_public_access,
  },
  sharedWith: [share.user],
  sharedGroup: [share.group],
  referenceForm: ObjectId,
  forms: [form],
  discrepancyForm: [form],
  mapping: Schema.Types.Mixed,
  labels: Schema.Types.Mixed,
  activeForm: String,
  activeDiscrepancyForm: String,
  data: [ObjectId],
  notes: [ObjectId],
  // decided by the active form input list
  // update with active form
  totalInput: {
    type: Number,
    default: 0,
    min: 0,
  },
  // decided by the touched inputs
  // keep for compatibility with previous versions
  finishedInput: {
    type: Number,
    default: 0,
    min: 0,
  },
  // list of inputs that have been touched accoring to the active form
  // update with traveler data and active form
  touchedInputs: [String],
  archived: {
    type: Boolean,
    default: false,
  },
});

/**
 * update the progress of binders that inlude this traveler document
 * @param  {Traveler} travelerDoc the traveler document
 * @return {undefined}
 */
function updateBinderProgress(travelerDoc) {
  Binder.find({
    archived: {
      $ne: true,
    },
    works: {
      $elemMatch: {
        _id: travelerDoc._id,
      },
    },
  }).exec(function(err, binders) {
    if (err) {
      return console.error(
        'cannot find binders for traveler ' +
          travelerDoc._id +
          ', error: ' +
          err.message
      );
    }
    binders.forEach(function(binder) {
      binder.updateWorkProgress(travelerDoc);
      binder.updateProgress();
    });
  });
}

traveler.pre('save', function(next) {
  var modifiedPaths = this.modifiedPaths();
  // keep it so that we can refer at post save
  this.wasModifiedPaths = modifiedPaths;
  next();
});

traveler.post('save', function(obj) {
  var modifiedPaths = this.wasModifiedPaths;
  if (
    modifiedPaths.indexOf('totalInput') !== -1 ||
    modifiedPaths.indexOf('finishedInput') !== -1 ||
    modifiedPaths.indexOf('status') !== -1
  ) {
    updateBinderProgress(obj);
  }
});

/**
 * type := 'file'
 *       | 'text'
 *       | 'textarea'
 *       | 'number'
 */

var travelerData = new Schema({
  traveler: ObjectId,
  name: String,
  value: Schema.Types.Mixed,
  file: {
    path: String,
    encoding: String,
    mimetype: String,
  },
  inputType: String,
  inputBy: String,
  inputOn: Date,
});

travelerData.pre('save', function validateNumber(next) {
  if (this.inputType === 'number') {
    if (typeof this.value !== this.inputType) {
      return next(
        new DataError('value "' + this.value + '" is not a number', 400)
      );
    }
  }
  next();
});

var travelerNote = new Schema({
  traveler: ObjectId,
  name: String,
  value: String,
  inputBy: String,
  inputOn: Date,
});

var Traveler = mongoose.model('Traveler', traveler);
var TravelerData = mongoose.model('TravelerData', travelerData);
var TravelerNote = mongoose.model('TravelerNote', travelerNote);

module.exports = {
  Traveler: Traveler,
  TravelerData: TravelerData,
  TravelerNote: TravelerNote,
  statusMap: statusMap,
  stateTransition: stateTransition,
};
