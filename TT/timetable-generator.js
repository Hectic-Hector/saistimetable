--- START OF FILE timetable-generator.js ---

class TimetableGenerator {
    constructor(schoolData, constraints) {
        this.schoolData = schoolData;
        this.constraints = constraints;
        this.timetables = {};
        this.globalSchedule = {};
        this.unassignedLessons = [];
        this.teacherStats = {};
    }

    generate() {
        console.log("Generator: Starting timetable generation process...");
        this._initialize();
        this._scheduleRestrictedSubjects();
        // Check if peSynchronization exists before calling the function
        if (this.constraints.peSynchronization && this.constraints.peSynchronization.length > 0) {
            this._schedulePESynchronization();
        }
        this._scheduleICTLessons();
        this._scheduleStrictDoubles();
        this._scheduleRemainingLessons();
        console.log(`Generator: Process complete. ${this.unassignedLessons.length} unassigned lesson groups.`);
        this._printTeacherStats();
        return this.timetables;
    }

    _initialize() {
        this.unassignedLessons = [];
        this.teacherStats = {};
        const allClasses = Object.keys(this.schoolData.teachers);

        allClasses.forEach(className => {
            this.timetables[className] = {};
            this.schoolData.days.forEach(day => {
                this.timetables[className][day] = {};
            });
        });

        this.schoolData.days.forEach(day => {
            this.globalSchedule[day] = {};
            this.schoolData.periods.forEach(period => {
                this.globalSchedule[day][period.id] = {
                    teachers: new Set(),
                    resources: {} // Initialize all possible resources here
                };
                // Dynamically add single resource subjects to global schedule
                this.constraints.singleResourceSubjects.forEach(resource => {
                    this.globalSchedule[day][period.id].resources[resource] = null;
                });
            });
        });

        const teacherSet = new Set(Object.values(this.schoolData.teachers).flatMap(Object.values));
        teacherSet.forEach(teacher => {
            this.teacherStats[teacher] = { totalPeriods: 0, dailyPeriods: {} };
            this.schoolData.days.forEach(day => this.teacherStats[teacher].dailyPeriods[day] = 0);
        });

        allClasses.forEach(className => {
            const division = this._getClassDivision(className);
            const subjects = this.schoolData.subjects[division];
            if (!subjects) return;
            Object.entries(subjects).forEach(([subject, periods]) => {
                const teacher = this.schoolData.teachers[className]?.[subject];
                if (teacher && this.teacherStats[teacher]) {
                    this.teacherStats[teacher].totalPeriods += periods;
                }
            });
        });
    }

    _getClassDivision(className) {
        const year = parseInt(className[0]);
        if (year <= 3) return "lowerPrimary";
        if (year <= 6) return "upperPrimary";
        return "lowerSecondary";
    }

    _getAvailableLessonSlots(className, day) {
        const division = this._getClassDivision(className);
        let slots = [...this.schoolData.divisionSchedules[division].lessonSlots];
        
        const eventsOnDay = this.schoolData.specialEvents.filter(e => e.day === day && (e.appliesTo === 'all' || (Array.isArray(e.appliesTo) && e.appliesTo.includes(division))));
        if (eventsOnDay.length > 0) {
            const eventPeriods = eventsOnDay.flatMap(e => e.periodIds || [e.periodId]);
            slots = slots.filter(s => !eventPeriods.includes(s));
        }
        
        return slots;
    }

    _countSubjectOnDay(className, subject, day) {
        return Object.values(this.timetables[className][day]).filter(l => l.subject === subject).length;
    }

    _getScheduledPeriods(className, subject) {
        return this.schoolData.days.reduce((acc, day) => acc + this._countSubjectOnDay(className, subject, day), 0);
    }

    canAssignLesson(className, subject, teacher, day, slot) {
        const { workloadLimits, teacherAvailability, subjectRestrictions, singleResourceSubjects } = this.constraints;
        if (!this.teacherStats[teacher]) return { valid: false, reason: "Teacher not found in stats" };

        if (
            this.teacherStats[teacher].dailyPeriods[day] >= (
                this.constraints.teacherWorkloadExceptions.includes(teacher)
                    ? workloadLimits.maxTeacherPeriodsPerDayException
                    : workloadLimits.maxTeacherPeriodsPerDay
            )
        ) {
            return { valid: false, reason: `Teacher workload exceeded` };
        }

        // Check if the slot is already taken by a special event for this class division
        const division = this._getClassDivision(className);
        const eventsOnDay = this.schoolData.specialEvents.filter(e => e.day === day && (e.appliesTo === 'all' || (Array.isArray(e.appliesTo) && e.appliesTo.includes(division))));
        const eventPeriods = eventsOnDay.flatMap(e => e.periodIds || [e.periodId]);
        if (eventPeriods.includes(slot)) {
            return { valid: false, reason: `Class slot booked by special event` };
        }
        
        // This constraint applies to the *class*, not a specific subject count.
        // It prevents any more lessons for the class on that day beyond the limit.
        // If maxClassPeriodsPerDay applies per subject, then the previous code was fine.
        // If it applies to total periods for the class, then this needs adjustment.
        // Assuming it's per subject as per your original logic:
        // if (this._countSubjectOnDay(className, subject, day) >= workloadLimits.maxClassPeriodsPerDay) return { valid: false, reason: `Subject max daily load` };
        
        const availabilityRule = teacherAvailability[teacher];
        if (availabilityRule) {
            if (availabilityRule.availableDays && !availabilityRule.availableDays.includes(day)) return { valid: false, reason: `Teacher only available on ${availabilityRule.availableDays.join()}` };
            if (availabilityRule.unavailableDays && availabilityRule.unavailableDays.includes(day)) return { valid: false, reason: `Teacher unavailable on ${day}` };
        }
        
        const subjectRule = subjectRestrictions[subject];
        if (subjectRule && subjectRule.days && !subjectRule.days.includes(day)) return { valid: false, reason: `Subject restricted to ${subjectRule.days.join()}` };
        
        if (this.globalSchedule[day][slot].teachers.has(teacher)) return { valid: false, reason: `Teacher booked` };
        if (this.timetables[className][day][slot]) return { valid: false, reason: `Class booked` };
        
        // Check if the subject uses a single resource and if that resource is already booked
        if (singleResourceSubjects.includes(subject)) {
            if (this.globalSchedule[day][slot].resources[subject]) {
                return { valid: false, reason: `${subject} resource booked` };
            }
        }
        
        return { valid: true };
    }

    assignLesson(className, subject, teacher, day, slot) {
        this.timetables[className][day][slot] = { subject, teacher };
        this.globalSchedule[day][slot].teachers.add(teacher);
        if (this.constraints.singleResourceSubjects.includes(subject)) {
            this.globalSchedule[day][slot].resources[subject] = className; // Mark resource as used by this class
        }
        this.teacherStats[teacher].dailyPeriods[day]++;
    }

    _scheduleLesson(lesson, allowedDays) {
        let { periods: periodsToSchedule, className, subject } = lesson;
        const division = this._getClassDivision(className);
        const rule = this.constraints.doublePeriodSubjects.find(r => r.subject === subject && r.divisions.includes(division));

        // Prioritize scheduling strict double periods first if the rule exists
        if (rule && rule.strict) {
            const doublesToSchedule = rule.strict === 'mixed' ? rule.structure.doubles : Math.floor(periodsToSchedule / 2);
            for (let i = 0; i < doublesToSchedule; i++) {
                if (this._scheduleSpecificPeriods(lesson, allowedDays, 2)) {
                    periodsToSchedule -= 2;
                } else {
                    // If we can't schedule a double, try singles for the remaining
                    break;
                }
            }
        }
        
        // Schedule remaining periods as singles or if strict doubles couldn't be met
        while (periodsToSchedule > 0) {
            if (this._scheduleSpecificPeriods(lesson, allowedDays, 1)) {
                periodsToSchedule--;
            } else {
                this.unassignedLessons.push({ className, subject, periodsRemaining: periodsToSchedule, reason: "Could not find a free slot for single period" });
                break;
            }
        }
    }

    _scheduleSpecificPeriods({ className, subject, teacher }, allowedDays, numPeriods) {
        const shuffledDays = [...allowedDays].sort(() => Math.random() - 0.5);

        for (const day of shuffledDays) {
            const slots = this._getAvailableLessonSlots(className, day);
            if (slots.length < numPeriods) continue;

            if (numPeriods === 1) {
                for (const slot of slots.sort(() => Math.random() - 0.5)) {
                    if (this.canAssignLesson(className, subject, teacher, day, slot).valid) {
                        this.assignLesson(className, subject, teacher, day, slot);
                        return true;
                    }
                }
            } else if (numPeriods === 2) {
                // Try consecutive slots first
                for (let i = 0; i < slots.length - 1; i++) {
                    if (slots[i+1] === slots[i] + 1) { // Check if consecutive
                         const [s1, s2] = [slots[i], slots[i+1]];
                         if (this.canAssignLesson(className, subject, teacher, day, s1).valid && this.canAssignLesson(className, subject, teacher, day, s2).valid) {
                            this.assignLesson(className, subject, teacher, day, s1);
                            this.assignLesson(className, subject, teacher, day, s2);
                            return true;
                        }
                    }
                }

                // Then try slots separated by a break/lunch
                const division = this._getClassDivision(className);
                const { breakPeriod, lunchPeriod } = this.schoolData.divisionSchedules[division];
                for (let i = 0; i < slots.length; i++) {
                    for (let j = i + 1; j < slots.length; j++) {
                        const s1 = slots[i];
                        const s2 = slots[j];
                        // Check for two slots with exactly one period in between, which must be break or lunch
                        if (s2 - s1 === 2) {
                            const middlePeriod = s1 + 1;
                            if (middlePeriod === breakPeriod || middlePeriod === lunchPeriod) {
                                if (this.canAssignLesson(className, subject, teacher, day, s1).valid && this.canAssignLesson(className, subject, teacher, day, s2).valid) {
                                    this.assignLesson(className, subject, teacher, day, s1);
                                    this.assignLesson(className, subject, teacher, day, s2);
                                    return true;
                                }
                            }
                        }
                    }
                }
            }
        }
        return false;
    }

    _scheduleSyncedPeriods(group, subject, numPeriods) {
        // Ensure all classes in the group have the same teacher for the subject for this to work
        const teacher = this.schoolData.teachers[group[0]][subject];
        if (!teacher) {
            console.warn(`Synced P.E.: Teacher for ${subject} not found for class ${group[0]}. Skipping group.`);
            return false;
        }

        // Get allowed days for the teacher
        let allowedDays = [...this.schoolData.days];
        const teacherAvail = this.constraints.teacherAvailability[teacher];
        if (teacherAvail) {
            if (teacherAvail.availableDays) {
                allowedDays = allowedDays.filter(d => teacherAvail.availableDays.includes(d));
            }
            if (teacherAvail.unavailableDays) {
                allowedDays = allowedDays.filter(d => !teacherAvail.unavailableDays.includes(d));
            }
        }

        for (const day of allowedDays.sort(() => Math.random() - 0.5)) {
            // Get available slots for the first class in the group
            // Assuming all classes in a synced group have the same division schedule and special events
            const slots = this._getAvailableLessonSlots(group[0], day);
            if (slots.length < numPeriods) continue;

            // Iterate through possible starting slots
            for (let i = 0; i <= slots.length - numPeriods; i++) {
                const potentialSlots = slots.slice(i, i + numPeriods);
                // For strict consecutive, ensure the difference between min and max slot is numPeriods - 1
                if (numPeriods > 1 && (potentialSlots[potentialSlots.length - 1] - potentialSlots[0] !== numPeriods - 1)) {
                    // This handles non-consecutive slots if numPeriods > 1.
                    // For example, if slots are [1, 2, 4] and numPeriods is 2, slice(0,2) is [1,2] (diff 1).
                    // Slice(1,3) is [2,4] (diff 2), which would be skipped by this check.
                    // If you want to allow non-consecutive slots separated by breaks/lunch for synced periods,
                    // this logic here for potentialSlots needs to be more complex, similar to _scheduleSpecificPeriods.
                    // For now, assuming strict consecutive slots for synced doubles.
                    continue;
                }

                // Check if all classes in the group can assign lessons in these potential slots
                const canAssignAll = group.every(c => 
                    potentialSlots.every(s => this.canAssignLesson(c, subject, teacher, day, s).valid)
                );

                if (canAssignAll) {
                    // Assign lessons for all classes in the group
                    group.forEach(c => potentialSlots.forEach(s => this.assignLesson(c, subject, teacher, day, s)));
                    return true;
                }
            }
        }
        return false;
    }
    
    // --- SCHEDULING ORDER ---
    _scheduleRestrictedSubjects() {
        console.log("Generator Step 1: Scheduling strictly restricted subjects...");
        Object.entries(this.constraints.subjectRestrictions).forEach(([subject, rule]) => {
            // Pass the restricted days to _scheduleAllForSubject
            this._scheduleAllForSubject(subject, rule.days);
        });
    }

    _schedulePESynchronization() {
        console.log("Generator Step 2: Scheduling synchronized P.E. lessons...");
        // Ensure peSynchronization exists and is an array before iterating
        if (!this.constraints.peSynchronization || !Array.isArray(this.constraints.peSynchronization)) {
            console.log("No P.E. synchronization rules found in constraints.");
            return;
        }

        this.constraints.peSynchronization.forEach(group => {
            const subject = "P.E.";
            // Get division for the first class in the group (assuming all in group are same division for P.E. planning)
            const division = this._getClassDivision(group[0]);
            const needed = this.schoolData.subjects[division]?.[subject];
            
            if (!needed) {
                console.warn(`P.E. subject or its periods not defined for division ${division} of group ${group.join()}. Skipping.`);
                return;
            }

            // Calculate how many periods are already scheduled for the first class in the group
            let scheduled = this._getScheduledPeriods(group[0], subject);
            
            // Continue scheduling until all periods are met
            while (scheduled < needed) {
                const periodsToSchedule = (needed - scheduled >= 2) ? 2 : 1; // Try to schedule doubles first
                if (this._scheduleSyncedPeriods(group, subject, periodsToSchedule)) {
                    scheduled += periodsToSchedule;
                } else {
                    // If a synced slot can't be found, log it and break
                    this.unassignedLessons.push({ className: group.join(','), subject, periodsRemaining: (needed - scheduled), reason: "Could not find sync P.E. slot" });
                    break;
                }
            }
        });
    }
    
    _scheduleICTLessons() {
        console.log("Generator Step 3: Scheduling ICT lessons (single resource)...");
        // ICT is implicitly handled by _scheduleAllForSubject and canAssignLesson's resource check
        this._scheduleAllForSubject("ICT");
    }
    
    _scheduleStrictDoubles() {
        console.log("Generator Step 4: Scheduling remaining strict double periods...");
        // Filter for rules that have 'strict' property set to true (or 'mixed')
        this.constraints.doublePeriodSubjects.filter(r => r.strict).forEach(rule => this._scheduleAllForSubject(rule.subject));
    }

    _scheduleRemainingLessons() {
        console.log("Generator Step 5: Scheduling all remaining lessons...");
        const allSubjects = [...new Set(Object.values(this.schoolData.subjects).flatMap(div => Object.keys(div)))];
        
        // Filter out subjects already handled by specific steps (e.g., P.E., ICT, strictly restricted, strict doubles)
        const subjectsToSkip = new Set();
        if (this.constraints.subjectRestrictions) {
            Object.keys(this.constraints.subjectRestrictions).forEach(s => subjectsToSkip.add(s));
        }
        if (this.constraints.singleResourceSubjects) {
            this.constraints.singleResourceSubjects.forEach(s => subjectsToSkip.add(s));
        }
        if (this.constraints.doublePeriodSubjects) {
            this.constraints.doublePeriodSubjects.filter(r => r.strict).forEach(r => subjectsToSkip.add(r.subject));
        }
        // If P.E. is in peSynchronization, it's handled. Check for the actual "P.E." subject name.
        if (this.constraints.peSynchronization && this.constraints.peSynchronization.length > 0) {
            subjectsToSkip.add("P.E.");
        }


        // Schedule the remaining subjects
        allSubjects.filter(subject => !subjectsToSkip.has(subject))
                   .sort(() => Math.random() - 0.5) // Randomize for better distribution
                   .forEach(subject => this._scheduleAllForSubject(subject));
    }

    _scheduleAllForSubject(subject, allowedDays = this.schoolData.days) {
        Object.keys(this.schoolData.teachers).forEach(className => {
            const division = this._getClassDivision(className);
            const teacher = this.schoolData.teachers[className]?.[subject];
            const needed = this.schoolData.subjects[division]?.[subject];
            
            if (teacher && needed !== undefined) { // Check for undefined, not just falsy
                 const scheduled = this._getScheduledPeriods(className, subject);
                if (scheduled < needed) {
                    this._scheduleLesson({
                        className, subject, teacher,
                        periods: needed - scheduled
                    }, allowedDays);
                }
            }
        });
    }

    _printTeacherStats() {
        console.log("\n--- Teacher Workload Summary ---");
        const sorted = Object.entries(this.teacherStats)
            .sort((a, b) => (b[1].totalPeriods || 0) - (a[1].totalPeriods || 0));
        
        sorted.forEach(([teacher, stats]) => {
            const dailyLoads = Object.entries(stats.dailyPeriods).map(([day, p]) => `${day.substr(0,1)}:${p}`).join(" ");
            console.log(`  ${teacher.padEnd(25)}: ${stats.totalPeriods} total | ${dailyLoads}`);
        });
        console.log("---------------------------------");
    }
}