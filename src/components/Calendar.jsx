import React, { useState, useMemo } from 'react';
import { ChevronLeft, ChevronRight, Filter, User, Check } from 'lucide-react';
import { supabase } from '../supabaseClient';
import { useMutation, useQueryClient } from '@tanstack/react-query';

export default function Calendar({ profile, house, houseMembers, chores }) {
    const queryClient = useQueryClient();
    const [currentDate, setCurrentDate] = useState(new Date());
    const [filterAssignee, setFilterAssignee] = useState('');

    // Quick complete mutation
    const completeChoreMutation = useMutation({
        mutationFn: async ({ choreId, currentAssigneeId, frequency, currentDueDate, name }) => {
            let updateFields = {
                last_completed_at: new Date().toISOString(),
                last_completed_by: profile.id
            };

            let nextAssigneeId = currentAssigneeId;

            // Rotate assignee if recurring
            if (frequency !== 'one-off' && houseMembers.length > 1) {
                const order = (chores.find(c => c.id === choreId)?.rotation_order || [])
                    .filter(uid => houseMembers.some(m => m.id === uid));

                const activeQueue = order.length > 0 ? order : houseMembers.map(m => m.id);
                const currentIndex = activeQueue.indexOf(currentAssigneeId);
                const nextIndex = currentIndex !== -1 ? (currentIndex + 1) % activeQueue.length : 0;
                nextAssigneeId = activeQueue[nextIndex];
                updateFields.assigned_to = nextAssigneeId;
            }

            if (frequency !== 'one-off') {
                const nextDueDate = new Date(currentDueDate || new Date());
                if (frequency === 'daily') {
                    nextDueDate.setDate(nextDueDate.getDate() + 1);
                } else if (frequency === 'weekly') {
                    nextDueDate.setDate(nextDueDate.getDate() + 7);
                } else if (frequency === 'monthly') {
                    nextDueDate.setMonth(nextDueDate.getMonth() + 1);
                }
                updateFields.due_date = nextDueDate.toISOString();
            }

            // Apply updates
            const { error: choreErr } = await supabase
                .from('chores')
                .update(updateFields)
                .eq('id', choreId);
            if (choreErr) throw choreErr;

            // Insert History
            await supabase.from('chore_history').insert([{
                house_id: house.id,
                chore_id: choreId,
                chore_name: name,
                completed_by: profile.id,
                action_type: 'complete'
            }]);

            // Add notification if assignee changed
            if (nextAssigneeId !== currentAssigneeId) {
                await supabase.from('chore_notifications').insert([{
                    house_id: house.id,
                    message: `${profile.name} completed "${name}". Next turn is yours!`,
                    profile_id: nextAssigneeId
                }]);
            }
        },
        onSuccess: () => {
            queryClient.invalidateQueries(['chores']);
            queryClient.invalidateQueries(['chore_history']);
            queryClient.invalidateQueries(['chore_notifications']);
        }
    });

    const handleCompleteChore = (chore) => {
        completeChoreMutation.mutate({
            choreId: chore.id,
            currentAssigneeId: chore.assigned_to,
            frequency: chore.frequency,
            currentDueDate: chore.due_date,
            name: chore.name
        });
    };

    // Calendar utility details
    const currYear = currentDate.getFullYear();
    const currMonth = currentDate.getMonth();

    const monthNames = [
        'January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'
    ];

    const prevMonth = () => {
        setCurrentDate(new Date(currYear, currMonth - 1, 1));
    };

    const nextMonth = () => {
        setCurrentDate(new Date(currYear, currMonth + 1, 1));
    };

    // Calculate days for the calendar grid
    const calendarDays = useMemo(() => {
        const firstDayIndex = new Date(currYear, currMonth, 1).getDay();
        const totalDays = new Date(currYear, currMonth + 1, 0).getDate();
        const prevTotalDays = new Date(currYear, currMonth, 0).getDate();

        const dayArray = [];

        // Previous month filler days
        for (let i = firstDayIndex - 1; i >= 0; i--) {
            dayArray.push({
                day: prevTotalDays - i,
                isCurrentMonth: false,
                dateObj: new Date(currYear, currMonth - 1, prevTotalDays - i)
            });
        }

        // Active month days
        for (let i = 1; i <= totalDays; i++) {
            dayArray.push({
                day: i,
                isCurrentMonth: true,
                dateObj: new Date(currYear, currMonth, i)
            });
        }

        // Next month filler days (grid row padding to 42 items representing 6 full rows)
        const remainingCells = 42 - dayArray.length;
        for (let i = 1; i <= remainingCells; i++) {
            dayArray.push({
                day: i,
                isCurrentMonth: false,
                dateObj: new Date(currYear, currMonth + 1, i)
            });
        }

        return dayArray;
    }, [currYear, currMonth]);

    // Match chores of current calendar day
    const getChoresForDay = (dateObj) => {
        const searchDateStr = dateObj.toISOString().split('T')[0];
        return chores.filter(chore => {
            if (!chore.due_date) return false;

            // If it is regular one-off completed in the past, do not show on tomorrow's calendar
            const isCompleted = chore.frequency === 'one-off' && chore.last_completed_at;
            if (isCompleted) {
                const compDateStr = new Date(chore.last_completed_at).toISOString().split('T')[0];
                return compDateStr === searchDateStr;
            }

            const dueDateStr = new Date(chore.due_date).toISOString().split('T')[0];
            const matchesDate = dueDateStr === searchDateStr;

            if (!matchesDate) return false;

            // Apply filter
            if (filterAssignee) {
                return chore.assigned_to === filterAssignee;
            }
            return true;
        });
    };

    return (
        <div>
            <div className="section-header">
                <div>
                    <h2>Chores Scheduler Calendar</h2>
                    <p className="text-secondary">Keep track of upcoming rotations and planned chore deadlines month-by-month.</p>
                </div>
            </div>

            {/* Filter and Month Controls */}
            <div className="glass-card" style={{ padding: '16px', marginBottom: '20px', display: 'flex', flexWrap: 'wrap', gap: '16px', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                    <button onClick={prevMonth} className="btn btn-secondary" style={{ padding: '8px' }}>
                        <ChevronLeft size={16} />
                    </button>
                    <h3 style={{ margin: 0, minWidth: '150px', textAlign: 'center' }}>
                        {monthNames[currMonth]} {currYear}
                    </h3>
                    <button onClick={nextMonth} className="btn btn-secondary" style={{ padding: '8px' }}>
                        <ChevronRight size={16} />
                    </button>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <Filter size={16} className="text-muted" />
                    <select
                        value={filterAssignee}
                        onChange={(e) => setFilterAssignee(e.target.value)}
                        className="input-field"
                        style={{ margin: 0, padding: '6px 12px', minWidth: '160px' }}
                    >
                        <option value="">All Roommates</option>
                        {houseMembers.map(member => (
                            <option key={member.id} value={member.id}>{member.name}</option>
                        ))}
                    </select>
                </div>
            </div>

            {/* Calendar Grid */}
            <div className="glass-card" style={{ padding: '4px', overflowX: 'auto' }}>
                <div style={{ minWidth: '700px' }}>
                    {/* Days of Week Header */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', borderBottom: '1px solid rgba(255,255,255,0.1)', paddingBottom: '8px', marginBottom: '8px', textAlign: 'center' }}>
                        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map(d => (
                            <div key={d} style={{ fontSize: '0.8rem', fontWeight: 'bold', color: 'var(--text-secondary)' }}>{d}</div>
                        ))}
                    </div>

                    {/* Monthly Days Grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: '4px' }}>
                        {calendarDays.map((cell, idx) => {
                            const choresForCell = getChoresForDay(cell.dateObj);
                            const isToday = cell.dateObj.toISOString().split('T')[0] === new Date().toISOString().split('T')[0];

                            return (
                                <div
                                    key={idx}
                                    style={{
                                        minHeight: '100px',
                                        background: cell.isCurrentMonth ? 'rgba(255, 255, 255, 0.02)' : 'rgba(255, 255, 255, 0.005)',
                                        border: isToday ? '1px solid var(--accent-purple)' : '1px solid rgba(255,255,255,0.05)',
                                        borderRadius: '8px',
                                        padding: '6px',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '4px',
                                        transition: 'background 0.2s',
                                        position: 'relative'
                                    }}
                                >
                                    {/* Day Number badge */}
                                    <span
                                        style={{
                                            fontSize: '0.75rem',
                                            fontWeight: isToday ? 'bold' : 'normal',
                                            color: isToday ? 'var(--accent-purple)' : cell.isCurrentMonth ? 'var(--text-primary)' : 'var(--text-muted)'
                                        }}
                                    >
                                        {cell.day}
                                    </span>

                                    {/* Chores Items in Cell */}
                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '3px', flexGrow: 1, overflowY: 'auto' }}>
                                        {choresForCell.map(chore => {
                                            const assignee = houseMembers.find(m => m.id === chore.assigned_to);
                                            const initials = assignee ? assignee.name.substring(0, 2).toUpperCase() : '??';
                                            const isDone = chore.frequency === 'one-off' && chore.last_completed_at;

                                            return (
                                                <div
                                                    key={chore.id}
                                                    onClick={() => !isDone && handleCompleteChore(chore)}
                                                    title={`Assigned: ${assignee ? assignee.name : 'Anyone'} (${chore.frequency})\nClick to complete`}
                                                    style={{
                                                        fontSize: '0.65rem',
                                                        padding: '3px 6px',
                                                        borderRadius: '4px',
                                                        background: isDone ? 'rgba(34, 197, 94, 0.15)' : 'rgba(168, 85, 247, 0.15)',
                                                        border: isDone ? '1px solid rgba(34, 197, 94, 0.3)' : '1px solid rgba(168, 85, 247, 0.3)',
                                                        color: isDone ? '#22c55e' : '#c084fc',
                                                        cursor: isDone ? 'default' : 'pointer',
                                                        display: 'flex',
                                                        justifyContent: 'space-between',
                                                        alignItems: 'center'
                                                    }}
                                                >
                                                    <span style={{ textDecoration: isDone ? 'line-through' : 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                        {chore.name}
                                                    </span>
                                                    <span
                                                        style={{
                                                            background: 'rgba(255, 255, 255, 0.1)',
                                                            padding: '1px 3px',
                                                            borderRadius: '2px',
                                                            fontSize: '0.55rem',
                                                            fontWeight: 'bold',
                                                            marginLeft: '4px'
                                                        }}
                                                    >
                                                        {initials}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
